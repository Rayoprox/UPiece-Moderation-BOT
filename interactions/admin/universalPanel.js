const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, MessageFlags, PermissionsBitField } = require('discord.js');
const { emojis, SUPREME_IDS } = require('../../utils/config.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const guildCache = require('../../utils/guildCache.js');

module.exports = async (interaction) => {
    const { customId, guild, user, values, client } = interaction;
    const db = client.db;
    const guildId = guild.id;

    if (customId === 'univ_toggle_lock') {
        if (!await safeDefer(interaction, true)) return;
        
        const isSupreme = SUPREME_IDS.includes(user.id);
        if (!isSupreme && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.followUp({ content: '⛔ Admin only.', flags: [MessageFlags.Ephemeral] });
        }

        const res = await db.query("SELECT universal_lock FROM guild_settings WHERE guildid = $1", [guildId]);
        const currentLock = res.rows[0]?.universal_lock || false;
        const newLockState = !currentLock;
        
        await db.query(`INSERT INTO guild_settings (guildid, universal_lock) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET universal_lock = $2`, [guildId, newLockState]);
        guildCache.flush(guildId);
        
        const embed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${newLockState ? `${emojis.lock} **RESTRICTED (Lockdown)**` : `${emojis.unlock} **DEFAULT (Standard)**`}`)
            .addFields(
                { name: `${emojis.unlock} Default YES`, value: 'Admins have full access. `/setup` works normally.' },
                { name: `${emojis.lock} Default NO`, value: 'Strict Mode. Admins have **NO** access unless explicitly whitelisted.' }
            )
            .setColor(newLockState ? 0xFF0000 : 0x00FF00);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(newLockState ? 'Switch to: Unlock' : 'Switch to: Lockdown')
                .setEmoji(newLockState ? (emojis.unlock || '🔓') : (emojis.lock || '🔒'))
                .setStyle(newLockState ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_edit_perms')
                .setLabel('Edit Permissions')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({ embeds: [embed], components: [row1] });
        return;
    }
   
    if (customId === 'univ_edit_perms') {
        if (!await safeDefer(interaction, true)) return;
        
        const commands = client.commands.map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);
        const menu = new StringSelectMenuBuilder().setCustomId('univ_select_cmd').setPlaceholder('Select command to edit...').addOptions(commands);
        const back = new ButtonBuilder().setCustomId('univ_back_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        
        await interaction.editReply({ 
            content: 'Select a command to override permissions:',
            embeds: [],
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }
    
    if (customId === 'univ_select_cmd') {
        if (!await safeDefer(interaction, true)) return;
        const cmdName = values[0];
        const menu = new RoleSelectMenuBuilder().setCustomId(`univ_role_${cmdName}`).setPlaceholder(`Select roles allowed to use /${cmdName}`).setMinValues(0).setMaxValues(25);
        const back = new ButtonBuilder().setCustomId('univ_edit_perms').setLabel('Back').setStyle(ButtonStyle.Secondary);
        
        await interaction.editReply({
            content: `Select Roles for **/${cmdName}** (Whitelist).`,
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)]
        });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('univ_role_')) {
        if (!await safeDefer(interaction, true)) return;
        const cmdName = customId.replace('univ_role_', '');
        
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        for (const rId of values) {
            await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]);
        }
        guildCache.flush(guildId);
        
        await interaction.editReply({ content: `✅ **Updated.** Roles for \`/${cmdName}\` set. Only these roles can use it when Locked.`, components: [] });
        return;
    }

    if (customId === 'univ_back_main') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guildId]);
        const isLocked = res.rows[0]?.universal_lock || false;

        const embed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? `${emojis.lock} **RESTRICTED (Lockdown)**` : `${emojis.unlock} **DEFAULT (Standard)**`}`)
            .addFields(
                { name: `${emojis.unlock} Default YES`, value: 'Admins have full access. `/setup` works normally.' },
                { name: `${emojis.lock} Default NO`, value: 'Strict Mode. Admins have **NO** access unless explicitly whitelisted.' }
            )
            .setColor(isLocked ? 0xFF0000 : 0x00FF00);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(isLocked ? 'Switch to: Unlock' : 'Switch to: Lockdown')
                .setEmoji(isLocked ? (emojis.unlock || '🔓') : (emojis.lock || '🔒'))
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_edit_perms')
                .setLabel('Edit Permissions')
                .setStyle(ButtonStyle.Primary)
        );
        
        await interaction.editReply({ content: null, embeds: [embed], components: [row1] });
        return;
    }
};