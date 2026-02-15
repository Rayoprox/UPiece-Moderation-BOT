const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;

    // HANDLE MODAL SUBMISSIONS FIRST (before any defer)
    if (interaction.isModalSubmit() && customId.startsWith('modal_antispam_threshold:')) {
        try {
            await interaction.deferUpdate();
        } catch (e) {
            console.error('[Modal Threshold] Defer error:', e);
            return;
        }
        const type = customId.split(':')[1];
        const threshold = parseInt(interaction.fields.getTextInputValue('threshold_value'), 10);
        console.log(`[Modal Threshold] Type: ${type}, Value: ${threshold}`);

        // Validate minimum values
        let minValue = 1;
        if (type === 'repeated' || type === 'emoji') minValue = 3;

        if (isNaN(threshold) || threshold < minValue) {
            console.log(`[Modal Threshold] Validation failed: minimum ${minValue}`);
            const errEmbed = new EmbedBuilder()
                .setDescription(`❌ Invalid threshold. Minimum: ${minValue}`)
                .setColor('#EF4444');
            await interaction.editReply({ embeds: [errEmbed] });
            return;
        }

        try {
            const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
            const current = res.rows[0] || {};
            let antispam = current.antispam || {};
            antispam[type] = antispam[type] || { bypass: [] };
            antispam[type].threshold = threshold;
            antispam[type].enabled = true;

            await client.db.query(
                `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guildid) DO UPDATE SET antispam = $4`,
                [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
            );
            console.log(`[Modal Threshold] Saved to DB: ${type} = ${threshold}`);
        } catch (dbErr) {
            console.error('[Modal Threshold] DB error:', dbErr);
            const fallbackEmbed = new EmbedBuilder()
                .setDescription(`❌ Database error: ${dbErr.message}`)
                .setColor('#EF4444');
            await interaction.editReply({ embeds: [fallbackEmbed] });
            return;
        }

        try {
            const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type, `✅ Threshold set to ${threshold}`);
            await interaction.editReply({ embeds: [embed], components });
            console.log(`[Modal Threshold] Response sent successfully`);
        } catch (err) {
            console.error('[Modal Threshold] Error building view:', err);
            const fallbackEmbed = new EmbedBuilder()
                .setTitle('✅ Threshold updated')
                .setDescription(`**${type}** threshold set to **${threshold}**`)
                .setColor('#10B981');
            await interaction.editReply({ embeds: [fallbackEmbed] });
        }
        return;
    }

    if (interaction.isModalSubmit() && customId.startsWith('modal_antispam_window:')) {
        try {
            await interaction.deferUpdate();
        } catch (e) {
            console.error('[Modal Window] Defer error:', e);
            return;
        }
        const type = customId.split(':')[1];
        const windowSeconds = parseInt(interaction.fields.getTextInputValue('window_value'), 10);
        console.log(`[Modal Window] Type: ${type}, Value: ${windowSeconds}`);

        if (isNaN(windowSeconds) || windowSeconds < 1) {
            console.log(`[Modal Window] Validation failed: minimum 1`);
            const errEmbed = new EmbedBuilder()
                .setDescription('❌ Invalid window. Minimum: 1 second')
                .setColor('#EF4444');
            await interaction.editReply({ embeds: [errEmbed] });
            return;
        }

        try {
            const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
            const current = res.rows[0] || {};
            let antispam = current.antispam || {};
            antispam[type] = antispam[type] || { bypass: [] };
            antispam[type].window_seconds = windowSeconds;

            await client.db.query(
                `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guildid) DO UPDATE SET antispam = $4`,
                [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
            );
            console.log(`[Modal Window] Saved to DB: ${type} = ${windowSeconds}s`);
        } catch (dbErr) {
            console.error('[Modal Window] DB error:', dbErr);
            const fallbackEmbed = new EmbedBuilder()
                .setDescription(`❌ Database error: ${dbErr.message}`)
                .setColor('#EF4444');
            await interaction.editReply({ embeds: [fallbackEmbed] });
            return;
        }

        try {
            const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type, `✅ Window set to ${windowSeconds}s`);
            await interaction.editReply({ embeds: [embed], components });
            console.log(`[Modal Window] Response sent successfully`);
        } catch (err) {
            console.error('[Modal Window] Error building view:', err);
            const fallbackEmbed = new EmbedBuilder()
                .setTitle('✅ Window updated')
                .setDescription(`**${type}** window set to **${windowSeconds}** seconds`)
                .setColor('#10B981');
            await interaction.editReply({ embeds: [fallbackEmbed] });
        }
        return;
    }

    // REST OF THE CODE (non-modal interactions)
    if (customId === 'setup_automod') {
        if (!await safeDefer(interaction, true)) return;
        const embed = new EmbedBuilder()
            .setTitle('🤖 Automod Control Center')
            .setDescription('Choose a module to configure below. Each module has its own rules and bypasses.')
            .addFields(
                { name: '🧷 Anti-Mention', value: 'Protect roles from being pinged.', inline: true },
                { name: '⚡ Anti-Spam', value: 'Control message rate, repeats and emoji spam.', inline: true },
                { name: '🔨 Auto-Punishment', value: 'Warn-based punishments (legacy automod).', inline: true }
            )
            .setFooter({ text: 'Use Back to return to Setup Home' })
            .setColor('#0EA5E9');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('automod_anti_mention').setLabel('Anti-Mention').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('automod_anti_spam').setLabel('Anti-Spam').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_autopunishment').setLabel('Auto-Punishment').setStyle(ButtonStyle.Success)
        );

        const back = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row, back] });
        return;
    }

    if (customId === 'automod_anti_mention') {
        if (!await safeDefer(interaction, true)) return;
        const { embed, components } = await buildAntiMentionView(client.db, guild.id);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    if (customId === 'automod_antimention_roles' || customId === 'automod_antimention_bypass') {
        if (!await safeDefer(interaction, true)) return;
        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        const nextProtected = customId === 'automod_antimention_roles' ? (values.length > 0 ? values : []) : (current.antimention_roles || []);
        const nextBypass = customId === 'automod_antimention_bypass' ? (values.length > 0 ? values : []) : (current.antimention_bypass || []);
        const antispam = current.antispam || {};

        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antimention_roles = $2, antimention_bypass = $3, antispam = $4`,
            [guild.id, nextProtected.length ? nextProtected : null, nextBypass.length ? nextBypass : null, antispam]
        );

        const { embed, components } = await buildAntiMentionView(client.db, guild.id, '✅ Anti-Mention updated.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // === ANTI-SPAM HANDLERS ===
    if (customId === 'automod_anti_spam') {
        if (!await safeDefer(interaction, true)) return;
        const { embed, components } = await buildAntiSpamView(client.db, guild.id);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    if (customId === 'automod_antispam_type_select') {
        if (!await safeDefer(interaction, true)) return;
        const type = values[0];
        const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Toggle enable/disable antispam
    if (customId.startsWith('automod_antispam_toggle:')) {
        if (!await safeDefer(interaction, true)) return;
        const type = customId.split(':')[1];
        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        let antispam = current.antispam || {};
        antispam[type] = antispam[type] || { threshold: 0, bypass: [] };
        antispam[type].enabled = !antispam[type].enabled;

        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antispam = $4`,
            [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
        );

        const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type, `✅ ${type} ${antispam[type].enabled ? 'Enabled' : 'Disabled'}.`);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Open threshold modal
    if (customId.startsWith('automod_antispam_threshold_modal:')) {
        const type = customId.split(':')[1];
        const res = await client.db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0]?.antispam || {};
        const config = current[type] || { threshold: 5 };

        const modal = new ModalBuilder()
            .setCustomId(`modal_antispam_threshold:${type}`)
            .setTitle(`Set Threshold for ${type}`);

        let label = '';
        if (type === 'mps') label = 'Messages per second (minimum 1)';
        else if (type === 'repeated') label = 'Repeated characters (minimum 3)';
        else label = 'Emojis per message (minimum 3)';

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('threshold_value')
                    .setLabel(label)
                    .setStyle(TextInputStyle.Short)
                    .setValue(config.threshold?.toString() || '5')
                    .setRequired(true)
            )
        );

        await interaction.showModal(modal);
        return;
    }

    // Open window_seconds modal (only for mps)
    if (customId.startsWith('automod_antispam_window_modal:')) {
        const type = customId.split(':')[1];
        if (type !== 'mps') return;

        const res = await client.db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0]?.antispam || {};
        const config = current[type] || { window_seconds: 1 };

        const modal = new ModalBuilder()
            .setCustomId(`modal_antispam_window:${type}`)
            .setTitle('Set Time Window (MPS)');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('window_value')
                    .setLabel('Seconds (minimum 1)')
                    .setStyle(TextInputStyle.Short)
                    .setValue((config.window_seconds || 1)?.toString())
                    .setRequired(true)
            )
        );

        await interaction.showModal(modal);
        return;
    }

    if (customId === 'automod_antispam_bypass_select') {
        if (!await safeDefer(interaction, true)) return;
        const type = interaction.message.embeds[0]?.footer?.text?.match(/Type: (\w+)/)?.[1];
        if (!type) return interaction.editReply({ embeds: [{ description: '❌ Error: Could not determine spam type.', color: 0xEF4444 }] });

        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        let antispam = current.antispam || {};
        antispam[type] = antispam[type] || {};
        antispam[type].bypass = values.length > 0 ? values : [];

        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antispam = $4`,
            [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
        );

        const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type, '✅ Bypass roles updated.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    if (customId.startsWith('automod_antispam_delete:')) {
        if (!await safeDefer(interaction, true)) return;
        const type = customId.split(':')[1];

        const res = await client.db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        let antispam = res.rows[0]?.antispam || {};
        delete antispam[type];

        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antispam = $4`,
            [guild.id, null, null, antispam]
        );

        const { embed, components } = await buildAntiSpamView(client.db, guild.id, '✅ Configuration deleted.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

};

async function buildAntiMentionView(db, guildId, statusText = null) {
    const res = await db.query('SELECT antimention_roles, antimention_bypass FROM automod_protections WHERE guildid = $1', [guildId]);
    const row = res.rows[0] || {};
    const protectedRoles = row.antimention_roles || [];
    const bypassRoles = row.antimention_bypass || [];

    const embed = new EmbedBuilder()
        .setTitle('🧷 Anti-Mention Configuration')
        .setDescription('Select the protected roles and who can bypass the system.')
        .addFields(
            { name: 'Protected Roles', value: protectedRoles.length ? protectedRoles.map(id => `<@&${id}>`).join(' ') : 'None', inline: false },
            { name: 'Bypass Roles', value: bypassRoles.length ? bypassRoles.map(id => `<@&${id}>`).join(' ') : 'None', inline: false }
        )
        .setFooter({ text: statusText || 'Changes apply immediately after selection.' })
        .setColor('#6366F1');

    const protectedSelect = new RoleSelectMenuBuilder()
        .setCustomId('automod_antimention_roles')
        .setPlaceholder('Select protected roles')
        .setMinValues(0)
        .setMaxValues(25);

    const bypassSelect = new RoleSelectMenuBuilder()
        .setCustomId('automod_antimention_bypass')
        .setPlaceholder('Select bypass roles')
        .setMinValues(0)
        .setMaxValues(25);

    const row1 = new ActionRowBuilder().addComponents(protectedSelect);
    const row2 = new ActionRowBuilder().addComponents(bypassSelect);
    const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row1, row2, back] };
}

async function buildAntiSpamView(db, guildId, statusText = null) {
    const res = await db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guildId]);
    const antispam = res.rows[0]?.antispam || {};

    const mpsConfig = antispam.mps || { threshold: 0, enabled: false, bypass: [] };
    const repeatedConfig = antispam.repeated || { threshold: 0, enabled: false, bypass: [] };
    const emojiConfig = antispam.emoji || { threshold: 0, enabled: false, bypass: [] };

    const mpsStatus = mpsConfig.enabled ? `✅ ${mpsConfig.threshold} msgs/sec${mpsConfig.window_seconds ? ` (${mpsConfig.window_seconds}s)` : ''}` : '❌ Disabled';
    const repeatedStatus = repeatedConfig.enabled ? `✅ ${repeatedConfig.threshold} chars` : '❌ Disabled';
    const emojiStatus = emojiConfig.enabled ? `✅ ${emojiConfig.threshold} emojis` : '❌ Disabled';

    const embed = new EmbedBuilder()
        .setTitle('⚡ Anti-Spam Configuration')
        .setDescription('Select a spam type to configure threshold, window, and bypass roles.')
        .addFields(
            { name: '📨 Messages/sec', value: mpsStatus, inline: true },
            { name: '🔁 Repeated Char', value: repeatedStatus, inline: true },
            { name: '😀 Emoji Spam', value: emojiStatus, inline: true }
        )
        .setFooter({ text: statusText || 'Select a type below to configure' })
        .setColor('#F59E0B');

    const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('automod_antispam_type_select')
        .setPlaceholder('Select spam type to configure')
        .addOptions([
            { label: '📨 Messages/sec', value: 'mps', description: 'Configure message rate limiting' },
            { label: '🔁 Repeated Characters', value: 'repeated', description: 'Configure repeated character detection' },
            { label: '😀 Emoji Spam', value: 'emoji', description: 'Configure emoji spam detection' }
        ]);

    const row1 = new ActionRowBuilder().addComponents(typeSelect);
    const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));

    return { embed, components: [row1, back] };
}

async function buildAntiSpamConfigView(db, guildId, type, statusText = null) {
    const res = await db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guildId]);
    const antispam = res.rows[0]?.antispam || {};
    const config = antispam[type] || { threshold: 5, bypass: [], enabled: false, window_seconds: 1 };

    const typeLabels = {
        mps: { name: '📨 Messages/sec', desc: 'How many messages per second', unit: 'msgs/sec' },
        repeated: { name: '🔁 Repeated Characters', desc: 'Max repeated characters allowed', unit: 'characters' },
        emoji: { name: '😀 Emoji Spam', desc: 'Max emojis per message', unit: 'emojis' }
    };

    const label = typeLabels[type] || typeLabels.mps;
    const statusStr = config.enabled ? '✅ ENABLED' : '❌ DISABLED';

    const embed = new EmbedBuilder()
        .setTitle(`${label.name} Configuration`)
        .setDescription(`Configure ${label.desc.toLowerCase()}.`)
        .addFields(
            { name: 'Status', value: statusStr, inline: true },
            { name: 'Current Threshold', value: config.threshold ? `**${config.threshold}** ${label.unit}` : 'Not set', inline: true },
            ...(type === 'mps' ? [{ name: 'Time Window', value: `**${config.window_seconds || 1}** seconds`, inline: true }] : []),
            { name: 'Bypass Roles', value: config.bypass?.length ? config.bypass.map(id => `<@&${id}>`).join(' ') : 'None', inline: false }
        )
        .setFooter({ text: `Type: ${type} | Configure below` })
        .setColor('#F59E0B');

    const thresholdBtn = new ButtonBuilder()
        .setCustomId(`automod_antispam_threshold_modal:${type}`)
        .setLabel('Set Threshold')
        .setStyle(ButtonStyle.Primary);

    const windowBtn = type === 'mps'
        ? new ButtonBuilder()
            .setCustomId(`automod_antispam_window_modal:${type}`)
            .setLabel('Set Window (seconds)')
            .setStyle(ButtonStyle.Primary)
        : null;

    const toggleBtn = new ButtonBuilder()
        .setCustomId(`automod_antispam_toggle:${type}`)
        .setLabel(config.enabled ? '🔴 Disable' : '🟢 Enable')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

    const bypassSelect = new RoleSelectMenuBuilder()
        .setCustomId('automod_antispam_bypass_select')
        .setPlaceholder('Select bypass roles')
        .setMinValues(0)
        .setMaxValues(25);

    const row1 = new ActionRowBuilder().addComponents(thresholdBtn, ...(windowBtn ? [windowBtn] : []), toggleBtn);
    const row2 = new ActionRowBuilder().addComponents(bypassSelect);
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('automod_anti_spam').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`automod_antispam_delete:${type}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Danger)
    );

    return { embed, components: [row1, row2, row3] };
}
