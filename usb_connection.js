/**
 * USB Connection for WebUSB
 */

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
                try {
                    await this.device.reset();
                } catch (e) {
                    console.warn("Device reset failed (non-fatal):", e);
                }
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
