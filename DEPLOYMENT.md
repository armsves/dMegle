# Deployment Guide for dMegle

## ⚠️ Important: WebSocket Support Required

dMegle uses **WebSocket connections** for real-time video streaming. **Vercel serverless functions do NOT support WebSocket connections**.

## Recommended Platforms

### 1. **Railway** (Recommended)
- ✅ Full WebSocket support
- ✅ Easy deployment
- ✅ Free tier available

**Deploy to Railway:**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

**Set environment variables in Railway dashboard:**
- `PRIVATE_KEY` - Your Arkiv private key
- `RPC_URL` - Arkiv RPC endpoint
- `WS_URL` - Arkiv WebSocket endpoint
- `PORT` - Server port (Railway sets this automatically)

### 2. **Render**
- ✅ WebSocket support
- ✅ Free tier available

**Deploy to Render:**
1. Connect your GitHub repo
2. Select "Web Service"
3. Build command: `npm install && npm run build`
4. Start command: `npm run server` (or `npm run omegle`)
5. Set environment variables

### 3. **Fly.io**
- ✅ WebSocket support
- ✅ Global edge deployment

**Deploy to Fly.io:**
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Launch app
fly launch
fly deploy
```

## Vercel Deployment (Limited Functionality)

If you must use Vercel, note that:
- ❌ WebSocket connections will NOT work
- ❌ Real-time streaming will NOT work
- ✅ Static pages will work
- ✅ API routes will work (without WebSocket)

**For Vercel:**
1. The `api/index.ts` file provides a basic serverless function
2. Static files in `public/` will be served
3. WebSocket features will be disabled

## Environment Variables

Set these in your deployment platform:

```env
PRIVATE_KEY=your_arkiv_private_key_here
RPC_URL=https://mendoza.hoodi.arkiv.network/rpc
WS_URL=wss://mendoza.hoodi.arkiv.network/rpc/ws
PORT=3000
```

## Build Commands

- **Build:** `npm run build`
- **Start Server:** `npm run server` (for video streaming)
- **Start Omegle:** `npm run omegle` (for Omegle-style chat)
- **Start Stream:** `npm run stream` (for camera streaming)

## Troubleshooting

### WebSocket Connection Failed
- ✅ Check if platform supports WebSocket
- ✅ Verify `WS_URL` environment variable
- ✅ Check firewall/network settings

### Serverless Function Crashed (Vercel)
- This is expected - WebSocket doesn't work on Vercel
- Deploy to Railway/Render/Fly.io instead

### Build Errors
- Run `npm run build` locally first
- Check TypeScript errors
- Verify all dependencies are in `package.json`

