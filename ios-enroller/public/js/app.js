import { log } from './logger.js';
import { checkStatus, initPairing } from './deviceStatus.js';
import { initDiscovery } from './discovery.js';
import { initTransfer } from './transfer.js';

initPairing();
initDiscovery();
initTransfer();

log('Initialisation et recherche de périphériques...');
setInterval(checkStatus, 3000);
checkStatus();
