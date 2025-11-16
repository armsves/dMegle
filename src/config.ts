import dotenv from 'dotenv';

dotenv.config();

export const config = {
  privateKey: process.env.PRIVATE_KEY || '',
  rpcUrl: process.env.RPC_URL || 'https://mendoza.hoodi.arkiv.network/rpc',
  wsUrl: process.env.WS_URL || 'wss://mendoza.hoodi.arkiv.network/rpc/ws',
  port: parseInt(process.env.PORT || '3000', 10),
};

if (!config.privateKey) {
  throw new Error('PRIVATE_KEY environment variable is required');
}

