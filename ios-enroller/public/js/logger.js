const logBox = document.getElementById('logBox');
const logCount = document.getElementById('logCount');
let messageCount = 0;

export function log(msg, type = '') {
    const time = new Date().toLocaleTimeString();
    const entryClass = type ? `log-entry ${type}` : 'log-entry';
    logBox.innerHTML += `<div class="${entryClass}"><span class="time">[${time}]</span>${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
    messageCount++;
    logCount.textContent = `${messageCount} msg`;
}

export function getMessageCount() {
    return messageCount;
}
