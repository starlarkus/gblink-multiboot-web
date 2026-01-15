# GB-Link Multiboot Web

A web-based tool for sending GBA ROMs to a Game Boy Advance via USB link cable adapter using WebUSB.

Hosted at https://multiboot.gblink.io/

## Features

- Send GBA ROMs (up to 256KB) directly from your browser
- WebUSB support - no drivers or software installation required
- Drag-and-drop file upload
- Real-time transfer progress
- Dark/light mode toggle

## Requirements

- **Browser:** Chrome or Edge (WebUSB support required)
- **Hardware:** USB link cable adapter with compatible firmware (e.g., RP2040-based with TinyUSB)
- **Link Cable** Gameboy Color link cable required
- **ROM:** Multiboot GBA ROM file (.gba or .bin, max 256KB)

## Usage

1. Open `index.html` in Chrome or Edge
2. Click **Connect USB** and select your link cable adapter
3. Drag & drop a multiboot `.gba` file (or click to browse)
4. Turn on your GBA with the link cable connected and no cartridge inserted
5. Click **Send Multiboot**
6. Wait for transfer to complete - the ROM will boot automatically!

## How It Works

The multiboot protocol sends a GBA ROM over the link cable using SPI communication:

1. **Handshake** - Detect GBA and exchange sync bytes
2. **Header** - Send first 192 bytes of ROM
3. **Encryption Setup** - Exchange CRC seeds
4. **Data Transfer** - Send encrypted ROM data with verification
5. **Finalization** - CRC validation and boot trigger

## Files

| File | Description |
|------|-------------|
| `index.html` | Main HTML page |
| `style.css` | Styling with dark/light mode |
| `app.js` | UI logic and event handling |
| `multiboot.js` | GBA multiboot protocol implementation |
| `usb_connection.js` | WebUSB connection handling |

## Technical Notes

- Uses `BigInt` for seed multiplication to avoid JavaScript precision loss
- Firmware configured for 36µs between 4-byte SPI transfers
- Supports vendor IDs: `0xCAFE` (TinyUSB) and `0x239A` (Adafruit)

## Compatible Firmware

This tool is designed to work with [gb-link-firmware-reconfigurable](https://github.com/starlarkus/gb-link-firmware-reconfigurable) 
running on an RP2040-based board (Raspberry Pi Pico, etc.).

## License

GPL-3.0