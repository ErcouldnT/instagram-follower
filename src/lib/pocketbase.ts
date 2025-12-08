import PocketBase from 'pocketbase';
// @ts-ignore - PUBLIC_POCKETBASE_URL will be available after .env is updated
import { PUBLIC_POCKETBASE_URL } from '$env/static/public';

export const pb = new PocketBase(PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090');
pb.autoCancellation(false);
