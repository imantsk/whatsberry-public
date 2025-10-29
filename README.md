<div align="center">

# <img src="public/img/apple-touch-icon.png" alt="WhatsBerry Logo" width="50" align="center"/> WhatsBerry

Bringing WhatsApp back to BlackBerry 10 and older Android devices.

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/MtU7JqrEnW) [![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support%20Dev-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/danzkigg)

</div>

## What is this?

WhatsBerry Public is a self-hosted (*alternative to [WhatsBerry.com](https://whatsberry.com)*) bridge that lets you use WhatsApp on devices that can no longer run the official app. If you have a BlackBerry 10 or an old Android phone (4.1+), this project gives those devices a second life.

The backend connects your device to WhatsApp Web, handling all the heavy lifting in the background so your device doesn't have to.

**Self-Hosted Solution:** Run your own WhatsApp bridge server on any machine with Node.js. No external dependencies, no third-party services - just you and your WhatsApp connection.

## How it works

Think of it like this: your phone (*with the WhatsBerry app*) talks to your self-hosted server, and the server talks to WhatsApp Web on your behalf. Everything happens in real-time, just like you'd expect from a messaging app.

1. Set up your own WhatsBerry server (see installation below)
2. Access the web interface at `http://your-server:3000/login`
3. Enter your server's API key
4. Scan the WhatsApp QR code
5. Configure your BlackBerry/Android app with server URL and API key
6. You can now send and receive messages, photos, videos, and more

## Features

- ✅ Send and receive messages in real-time
- ✅ Share photos, videos, and documents
- ✅ Download and view media from your chats
- ✅ See your contacts and groups
- ✅ Read receipts
- ✅ Profile pictures for your contacts
- ✅ Audio conversion
- ✅ Session persistence and automatic cleanup
- ✅ WebSocket support for real-time updates

## Installation

### Prerequisites

- Node.js 16.0.0 or higher
- npm (comes with Node.js)
- A server or computer to run the backend (can be a Raspberry Pi, VPS, or your PC)

### Step 1: Clone the Repository

```bash
git clone https://github.com/danzkigg/whatsberry-public.git
cd whatsberry-public
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file and set your configuration:

```env
# Server Port
PORT=3000

# API Key - Generate a secure random string
# You can generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY=your_secure_api_key_here
```

**Important:** Generate a strong API key for security. You can use this command:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Start the Server

```bash
npm start
```

Or use PM2 for process management:

```bash
npm install -g pm2
npm run pm2:start
```

The server will start on `http://localhost:3000` (or your configured port).

## Usage

### Web Interface

1. Open your browser and go to `http://your-server:3000/login`
2. Enter your API key (the same one from your `.env` file)
3. Scan the QR code with WhatsApp on your phone:
   - **Android:** Menu ⋮ → Linked devices → Link device
   - **iPhone:** Settings ⚙ → Linked devices → Link device
4. Once connected, you'll see your phone number

### BlackBerry/Android App

1. Download the WhatsBerry app for your device
2. Configure the app:
   - **Server URL:** `http://your-server-ip:3000`
   - **API Key:** Your API key from `.env`
3. Connect and start messaging!

See [TECHNICAL.md](TECHNICAL.md) for full API documentation.

## Built With

This is a Node.js server that uses:
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API interface
- [Socket.IO](https://socket.io/) - Real-time WebSocket communication
- [Express](https://expressjs.com/) - Web server framework
- [Puppeteer](https://pptr.dev/) - Headless Chrome for WhatsApp Web
- [FFmpeg](https://ffmpeg.org/) - Media file conversion

## Security

Security is built-in from the ground up:
- **API Key Authentication** - All requests require a valid API key
- **Automatic Cleanup** - Inactive sessions are automatically destroyed
- **No Data Storage** - Messages are never stored on the server
- **Self-Hosted** - You control the server and your data

**Best Practices:**
- Use a strong, random API key (at least 32 characters)
- Run the server behind a reverse proxy (nginx) with HTTPS
- Use a firewall to restrict access to trusted IPs
- Keep your server and dependencies up to date
- Never share your API key publicly

## Troubleshooting

### Server won't start
- Make sure Node.js 16+ is installed: `node --version`
- Check if port 3000 is already in use: `lsof -i :3000` (Mac/Linux) or `netstat -ano | findstr :3000` (Windows)
- Verify your `.env` file exists and has an `API_KEY` set

### Can't connect from app
- Make sure the server is running
- Check firewall settings - port 3000 must be accessible
- Use the correct IP address (not `localhost` when connecting from another device)
- Verify the API key matches between `.env` and the app

### QR code not appearing
- Wait 15-20 seconds for initialization
- Check server logs for errors: `npm run pm2:logs`
- Restart the server: `npm run pm2:restart`

### Session disconnects frequently
- Check your internet connection stability
- Ensure WhatsApp is logged in on your phone
- WhatsApp may have logged out the linked device - re-scan QR code

### Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

For major changes, please open an issue first to discuss what you'd like to change.

## Technical Documentation

For detailed API documentation, architecture details, and development information, see [TECHNICAL.md](TECHNICAL.md).

## License

**WhatsBerry** is released under the Apache-2.0 License with Commons Clause, which allows code inspection and contribution while preventing commercial use. See the [LICENSE.md](LICENSE.md) for full details.

## Disclaimer

⚠️ **Important:** This is an unofficial project. WhatsApp does not officially support third-party clients or bots. Use at your own risk.

---
<div align="center">
❤️ Made with care for the BlackBerry and retro Android community.
</div>
