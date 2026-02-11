const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../../utils/db.js');
const guildCache = require('../../../utils/guildCache.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { safeDefer, smartReply } = require('../../../utils/interactionHelpers.js');

async function showPrefixMenu(interaction, guildId) {
    let settings = { prefix: '!', delete_prefix_cmd_message: false };
    
    try {
        const res = await db.query('SELECT prefix, delete_prefix_cmd_message FROM guild_settings WHERE guildid = $1', [guildId]);
        if (res.rows[0]) settings = res.rows[0];
    } catch (e) {
        // Si falla por columna no existente, intenta sin delete_prefix_cmd_message
        if (e.message.includes('delete_prefix_cmd_message')) {
            const res = await db.query('SELECT prefix FROM guild_settings WHERE guildid = $1', [guildId]);
            if (res.rows[0]) settings = { prefix: res.rows[0].prefix, delete_prefix_cmd_message: false };
        } else {
            throw e;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('⌨️ Prefix Configuration')
        .setDescription('Manage your server prefix and command message behavior.')
        .addFields(
            { name: 'Current Prefix', value: `\`${settings.prefix}\``, inline: true },
            { name: 'Delete Command Messages', value: settings.delete_prefix_cmd_message ? '✅ ENABLED' : '❌ DISABLED', inline: true }
        )
        .setColor('#5865F2')
        .setFooter({ text: 'Made by Ukirama' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prefix_change').setLabel('Change Prefix').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
        new ButtonBuilder().setCustomId('prefix_toggle_delete').setLabel('Toggle Message Deletion').setStyle(settings.delete_prefix_cmd_message ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji(settings.delete_prefix_cmd_message ? '🗑️' : '💬'),
        new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
    );

    return { embed, components: [row] };
}

module.exports = async (interaction) => {
    const { customId, guild } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_prefix') {
        if (!await safeDefer(interaction, true)) return;

        const { embed, components } = await showPrefixMenu(interaction, guildId);
        await smartReply(interaction, { embeds: [embed], components });
        return;
    }

    if (customId === 'prefix_change') {
        const modal = new ModalBuilder().setCustomId('modal_prefix_change').setTitle('Change Server Prefix');
        const prefixInput = new TextInputBuilder()
            .setCustomId('prefix_input')
            .setLabel("New Prefix (Max 3 chars)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('!, ., ?, kb!, etc.')
            .setMaxLength(3)
            .setRequired(true);
        const row = new ActionRowBuilder().addComponents(prefixInput);
        modal.addComponents(row);
        
        try {
            await interaction.showModal(modal);
        } catch (error) {
            console.error('[PREFIX] Error showing modal:', error);
        }
        return;
    }

    if (customId === 'modal_prefix_change') {
        if (!interaction.isModalSubmit()) return;
        
        if (!await safeDefer(interaction, true)) return;

        const newPrefix = interaction.fields.getTextInputValue('prefix_input').trim();

        if (!newPrefix) {
            await smartReply(interaction, { embeds: [error("Prefix cannot be empty.")] });
            return;
        }
        if (newPrefix.length > 3) {
            await smartReply(interaction, { embeds: [error("Prefix must be 3 characters or less.")] });
            return;
        }
        if (!/^[a-zA-Z0-9!@#$%^&*\-_+=.?~`]+$/.test(newPrefix)) {
            await smartReply(interaction, { embeds: [error("Prefix contains invalid characters. Use letters, numbers, or: !@#$%^&*-_+=.?~`")] });
            return;
        }

        try {
            await db.query(
                `INSERT INTO guild_settings (guildid, prefix) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET prefix = $2`,
                [guildId, newPrefix]
            );

            let cached = guildCache.get(guildId);
            if (!cached) cached = { settings: {}, permissions: [] };
            cached.settings.prefix = newPrefix;
            guildCache.set(guildId, cached);

            const { embed, components } = await showPrefixMenu(interaction, guildId);
            await smartReply(interaction, { embeds: [embed], components });
        } catch (err) {
            console.error(err);
            await smartReply(interaction, { embeds: [error("Database error.")] });
        }
        return;
    }

    if (customId === 'prefix_toggle_delete') {
        if (!await safeDefer(interaction, true)) return;

        try {
            let currentState = false;
            
            // Intenta SELECT con la columna; si no existe, usa fallback
            try {
                const res = await db.query(
                    'SELECT delete_prefix_cmd_message FROM guild_settings WHERE guildid = $1',
                    [guildId]
                );
                currentState = res.rows[0]?.delete_prefix_cmd_message || false;
            } catch (e) {
                if (e.message?.includes('delete_prefix_cmd_message')) {
                    console.log('ℹ️  Columna delete_prefix_cmd_message no existe aún en BD');
                    currentState = false;
                } else {
                    throw e;
                }
            }
            
            const newState = !currentState;

            // Intenta UPDATE con la columna; si falla, ignora
            try {
                await db.query(
                    `INSERT INTO guild_settings (guildid, delete_prefix_cmd_message) VALUES ($1, $2) 
                     ON CONFLICT (guildid) DO UPDATE SET delete_prefix_cmd_message = $2`,
                    [guildId, newState]
                );
            } catch (e) {
                if (e.message?.includes('delete_prefix_cmd_message')) {
                    console.log('ℹ️  No se pudo actualizar delete_prefix_cmd_message (columna no existe aún)');
                    // Simplemente continúa sin actualizar esa columna específica
                } else {
                    throw e;
                }
            }

            let cached = guildCache.get(guildId);
            if (!cached) cached = { settings: {}, permissions: [] };
            cached.settings.delete_prefix_cmd_message = newState;
            guildCache.set(guildId, cached);

            const { embed, components } = await showPrefixMenu(interaction, guildId);
            await smartReply(interaction, { embeds: [embed], components });
        } catch (err) {
            console.error(err);
            await smartReply(interaction, { embeds: [error("Database error.")] });
        }
        return;
    }
};
