/**
 * USB Connection for WebUSB
 */

// Check firmware version from USB device descriptor (bcdDevice)
// Available instantly on the device object — no USB transfers needed
function fwVersionAtLeast(device, minMajor, minMinor, minPatch) {
    if (!device) return false;
    const major = device.deviceVersionMajor || 0;
    const minor = device.deviceVersionMinor || 0;
    const patch = device.deviceVersionSubminor || 0;
    if (major !== minMajor) return major > minMajor;
    if (minor !== minMinor) return minor > minMinor;
    return patch >= minPatch;
}

// Magic packet prefix (32 bytes shared by all magic packets)
const MAGIC_PREFIX = new Uint8Array([
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE, 0xCA, 0xFE,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF,
    0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD, 0xBE, 0xEF
]);

function buildVswitchPacket(suffix) {
    const packet = new Uint8Array(36);
    packet.set(MAGIC_PREFIX);
    packet.set(new TextEncoder().encode(suffix), 32);
    return packet;
}

const VSWITCH_3V3_PACKET = buildVswitchPacket('V3V3');
const VSWITCH_5V_PACKET = buildVswitchPacket('V5V0');

// LED magic packet: 32-byte prefix + "LEDS" + R, G, B, on/off = 40 bytes
const LED_PREFIX = new Uint8Array([
    ...MAGIC_PREFIX,
    0x4C, 0x45, 0x44, 0x53  // "LEDS"
]);

function buildLedPacket(r, g, b, on) {
    const packet = new Uint8Array(40);
    packet.set(LED_PREFIX);
    packet[36] = r;
    packet[37] = g;
    packet[38] = b;
    packet[39] = on ? 1 : 0;
    return packet;
}

class UsbConnection {
    constructor() {
        this.device = null;
        this.interfaceNumber = 0;
        this.endpointIn = 0;
        this.endpointOut = 0;
        this.isConnected = false;
    }

    async connect() {
        try {
            const filters = [
                { vendorId: 0xcafe }, // TinyUSB / GB Link Adapter
                { vendorId: 0x239A }  // Adafruit boards
            ];

            this.device = await navigator.usb.requestDevice({ filters: filters });
            await this.device.open();

            // Fix for stale connections on refresh
            if (this.device.reset) {
                await this.device.reset().catch(e => {
                    console.warn("Device reset failed (non-fatal):", e);
                });
            }

            await this.device.selectConfiguration(1);

            // Find interface and endpoints
            const interfaces = this.device.configuration.interfaces;
            let foundInterface = false;

            for (const iface of interfaces) {
                for (const alt of iface.alternates) {
                    if (alt.interfaceClass === 0xFF) {
                        this.interfaceNumber = iface.interfaceNumber;

                        for (const endpoint of alt.endpoints) {
                            if (endpoint.direction === "out") {
                                this.endpointOut = endpoint.endpointNumber;
                            }
                            if (endpoint.direction === "in") {
                                this.endpointIn = endpoint.endpointNumber;
                            }
                        }
                        foundInterface = true;
                        break;
                    }
                }
                if (foundInterface) break;
            }

            if (!foundInterface) {
                throw new Error("Could not find compatible interface");
            }

            await this.device.claimInterface(this.interfaceNumber);
            await this.device.selectAlternateInterface(this.interfaceNumber, 0);

            // Initialize connection
            await this.device.controlTransferOut({
                requestType: 'class',
                recipient: 'interface',
                request: 0x22,
                value: 0x01,
                index: this.interfaceNumber
            });

            this.isConnected = true;

            // Check firmware version from USB device descriptor (bcdDevice)
            const fwVer = `${this.device.deviceVersionMajor}.${this.device.deviceVersionMinor}.${this.device.deviceVersionSubminor}`;
            console.log("Firmware version (bcdDevice):", fwVer);

            // GBA multiboot requires 3.3V
            await this.setVoltage('3v3');

            return true;

        } catch (error) {
            console.error("USB Connection failed:", error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.device) {
            try {
                await this.device.releaseInterface(this.interfaceNumber);
                await this.device.close();
            } catch (e) {
                console.warn("Disconnect warning:", e);
            }
            this.device = null;
            this.isConnected = false;
        }
    }

    async writeBytes(data) {
        if (!this.isConnected) throw new Error("Not connected");

        const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
        await this.device.transferOut(this.endpointOut, buffer);
    }

    async setVoltage(mode) {
        if (!this.isConnected || !fwVersionAtLeast(this.device, 1, 0, 6)) return false;
        const packet = mode === '5v' ? VSWITCH_5V_PACKET : VSWITCH_3V3_PACKET;
        await this.device.transferOut(this.endpointOut, packet);
        try {
            await Promise.race([
                this.device.transferIn(this.endpointIn, 64),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
            ]);
        } catch (e) { /* ack timeout is non-fatal */ }
        console.log(`Voltage switched to ${mode}`);
        return true;
    }

    async setLed(r, g, b, on = true) {
        if (!this.isConnected || !fwVersionAtLeast(this.device, 1, 0, 6)) return false;
        const packet = buildLedPacket(r, g, b, on);
        await this.device.transferOut(this.endpointOut, packet);
        try {
            await Promise.race([
                this.device.transferIn(this.endpointIn, 64),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
            ]);
        } catch (e) { /* ack timeout is non-fatal */ }
        return true;
    }

    async readBytesRaw(length = 64, timeoutMs = 100) {
        if (!this.isConnected) throw new Error("Not connected");

        try {
            // Race between read and timeout
            const result = await Promise.race([
                this.device.transferIn(this.endpointIn, length),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Read timeout")), timeoutMs)
                )
            ]);

            if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
                return new Uint8Array(result.data.buffer);
            }
        } catch (e) {
            // Timeout or no data - return empty
        }
        return new Uint8Array(0);
    }
}

// Export
window.UsbConnection = UsbConnection;
