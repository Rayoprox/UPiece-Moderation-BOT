const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../../utils/db.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_antinuke') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const isEnabled = res.rows[0]?.antinuke_enabled || false;
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`The Anti-Nuke system automatically backups the server state (Roles, Channels) daily and allows restoration.\n\n**Status:** ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable System' : 'Enable System').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    if (customId === 'antinuke_toggle') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const newState = !(res.rows[0]?.antinuke_enabled || false);
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`**Status:** ${newState ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(newState ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(newState ? 'Disable System' : 'Enable System').setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }
};