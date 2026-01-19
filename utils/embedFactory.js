const { EmbedBuilder } = require('discord.js');
const { emojis } = require('./config.js');

/**
 * 
 * @param {string} type 
 * @param {string} description 
 */
const createEmbed = (type, description) => {
    let color, titleEmoji;
    
    switch (type) {
        case 'success':
            color = 0x2ECC71; // Emerald Green
            titleEmoji = emojis?.success || '✅';
            break;
        case 'error':
            color = 0xE74C3C; // Alizarin Red
            titleEmoji = emojis?.error || '❌';
            break;
        case 'warn':
            color = 0xF1C40F; // Sun Flower Yellow
            titleEmoji = emojis?.warn || '⚠️';
            break;
        case 'info':
        default:
            color = 0x3498DB; // Peter River Blue
            titleEmoji = emojis?.info || 'ℹ️';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setDescription(`${titleEmoji} ${description}`);
};

module.exports = {
    success: (text) => createEmbed('success', text),
    error: (text) => createEmbed('error', text),
    warn: (text) => createEmbed('warn', text),
    info: (text) => createEmbed('info', text)
};