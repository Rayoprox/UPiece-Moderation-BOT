const { EmbedBuilder } = require('discord.js');
const { emojis } = require('./config.js');

const createEmbed = (type, description) => {
    let color, titleEmoji;
    
    switch (type) {
        case 'success':
            color = 0x2ECC71; 
            titleEmoji = emojis?.success || '✅';
            break;
        case 'error':
            color = 0xE74C3C; 
            titleEmoji = emojis?.error || '❌';
            break;
        case 'warn':
            color = 0xF1C40F; 
            titleEmoji = emojis?.warn || '⚠️';
            break;
        case 'info':
        default:
            color = 0x3498DB; 
            titleEmoji = emojis?.info || 'ℹ️';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setDescription(`${titleEmoji} ${description}`);
};

const createModerationEmbed = (description) => {
    return new EmbedBuilder()
        .setColor(0x2ECC71) 
        .setDescription(description)
        .setFooter({ text: 'Made by: ukirama' });
};

module.exports = {
    success: (text) => createEmbed('success', text),
    error: (text) => createEmbed('error', text),
    warn: (text) => createEmbed('warn', text),
    info: (text) => createEmbed('info', text),
    moderation: (text) => createModerationEmbed(text)
};