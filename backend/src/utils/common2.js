import crypto from 'crypto';
export const crypto_randomInt = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
