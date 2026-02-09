const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const ms = require('ms');
const { emojis } = require('../../utils/config.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;
    const db = client.db;
    const guildId = guild.id;
    
    const setupCommand = client.commands.get('setup');
    const generateSetupContent = setupCommand?.generateSetupContent;

    if (customId === 'automod_add_rule') {
        if (!await safeDefer(interaction, true)) return;
        const menu = new StringSelectMenuBuilder()
            .setCustomId('automod_action_select')
            .setPlaceholder('1. Select punishment type...')
            .addOptions([
                { label: 'Ban', value: 'BAN', description: 'Ban user (Temporary or Permanent)' },
                { label: 'Mute (Timeout)', value: 'MUTE', description: 'Timeout user (Max 28 days)' },
                { label: 'Kick', value: 'KICK', description: 'Kick user from server' }
            ]);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_autopunishment').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
        
        await interaction.editReply({ 
            embeds: [new EmbedBuilder()
                .setTitle('🤖 Auto-Punishment Setup')
                .setDescription('Step 1/3: Choose the action type for this rule.')
                .addFields({ name: 'Tip', value: 'Rules trigger when a user reaches the warning count.' })
                .setColor('#3B82F6')], 
            components: [new ActionRowBuilder().addComponents(menu), backButton] 
        });
        return;
    }

    if (customId === 'setup_autopunishment') { 
        if (!await safeDefer(interaction, true)) return;
        
        const btns = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('automod_add_rule').setLabel('Add Rule').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('automod_remove_rule').setLabel('Remove Rule').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('setup_automod').setLabel('Back').setStyle(ButtonStyle.Secondary) 
        );
        
        const rulesRes = await db.query('SELECT * FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
        const desc = rulesRes.rows.map(r => {
            let durationText = '';
            if (r.action_type === 'BAN') durationText = r.action_duration ? `(${r.action_duration})` : '(Permanent)';
            if (r.action_type === 'MUTE') durationText = `(${r.action_duration})`;
            return `• **${r.warnings_count} Warns:** ${r.action_type} ${durationText}`;
        }).join('\n') || "No rules configured.";

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle('🤖 Auto-Punishment Configuration')
                .setDescription(desc)
                .addFields(
                    { name: '➕ Add', value: 'Create a new warn rule', inline: true },
                    { name: '🗑️ Remove', value: 'Delete an existing rule', inline: true },
                    { name: '⬅️ Back', value: 'Return to Automod menu', inline: true }
                )
                .setFooter({ text: 'Rules are evaluated in ascending warning order.' })
                .setColor('#10B981')],
            components: [btns]
        });
        return;
    }

    if (customId === 'automod_action_select') {
        if (!await safeDefer(interaction, true)) return;
        const action = values[0];
        const warnOptions = Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} Warning${i > 0 ? 's' : ''}`, value: `${i + 1}:${action}` }));
        
        const menu = new StringSelectMenuBuilder().setCustomId('automod_warn_select').setPlaceholder('2. Select warning count...').addOptions(warnOptions);
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle('🤖 Auto-Punishment Setup')
                .setDescription(`Step 2/3: Choose the warning count for **${action}**.`)
                .setColor('#3B82F6')],
            components: [new ActionRowBuilder().addComponents(menu)]
        });
        return;
    }

    if (customId === 'automod_warn_select') {
        const [warnCountStr, actionType] = values[0].split(':');
        const warnCount = parseInt(warnCountStr, 10);

        if (actionType === 'KICK') {
            await safeDefer(interaction, true);
            await saveRule(db, guildId, warnCount, actionType, null);
            
            if (generateSetupContent) {
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: null, embeds: [success(`Automod rule saved: **${warnCount} Warns -> KICK**`), embed], components });
            } else await interaction.editReply({ embeds: [success(`Automod rule saved.`)] });
            return;
        }

        const durationOptions = actionType === 'BAN'
            ? [
                { label: 'Permanent', value: `PERM:${warnCountStr}:${actionType}` },
                { label: '1 Day', value: `1d:${warnCountStr}:${actionType}` },
                { label: '3 Days', value: `3d:${warnCountStr}:${actionType}` },
                { label: '7 Days', value: `7d:${warnCountStr}:${actionType}` },
                { label: '14 Days', value: `14d:${warnCountStr}:${actionType}` },
                { label: '30 Days', value: `30d:${warnCountStr}:${actionType}` },
                { label: '90 Days', value: `90d:${warnCountStr}:${actionType}` },
                { label: 'Custom...', value: `CUSTOM:${warnCountStr}:${actionType}` }
            ]
            : [
                { label: '5 Minutes', value: `5m:${warnCountStr}:${actionType}` },
                { label: '10 Minutes', value: `10m:${warnCountStr}:${actionType}` },
                { label: '30 Minutes', value: `30m:${warnCountStr}:${actionType}` },
                { label: '1 Hour', value: `1h:${warnCountStr}:${actionType}` },
                { label: '6 Hours', value: `6h:${warnCountStr}:${actionType}` },
                { label: '12 Hours', value: `12h:${warnCountStr}:${actionType}` },
                { label: '1 Day', value: `1d:${warnCountStr}:${actionType}` },
                { label: '7 Days', value: `7d:${warnCountStr}:${actionType}` },
                { label: '28 Days', value: `28d:${warnCountStr}:${actionType}` },
                { label: 'Custom...', value: `CUSTOM:${warnCountStr}:${actionType}` }
            ];

        const durationMenu = new StringSelectMenuBuilder()
            .setCustomId('automod_duration_select')
            .setPlaceholder('3. Select duration...')
            .addOptions(durationOptions);

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setTitle('🤖 Auto-Punishment Setup')
                .setDescription(`Step 3/3: Choose duration for **${actionType}**.`)
                .addFields({ name: 'Quick Tip', value: 'Pick Custom for a manual duration like 2h or 15d.' })
                .setColor('#3B82F6')],
            components: [new ActionRowBuilder().addComponents(durationMenu)]
        });
        return;
    }

    if (customId === 'automod_remove_rule') {
        if (!await safeDefer(interaction, true)) return;
        const rulesResult = await db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
        
        if (rulesResult.rows.length === 0) return interaction.editReply({ embeds: [error('No rules found to remove.')] });
        
        const options = rulesResult.rows.map(rule => ({ 
            label: `Rule #${rule.rule_order}: ${rule.warnings_count} warns -> ${rule.action_type}`, 
            description: rule.action_duration || 'Permanent/None',
            value: rule.rule_order.toString() 
        }));
        
        const menu = new StringSelectMenuBuilder().setCustomId('automod_select_remove').setPlaceholder('Select rule to remove...').addOptions(options);
        const back = new ButtonBuilder().setCustomId('setup_autopunishment').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ content: null, embeds: [new EmbedBuilder()
            .setTitle('🧹 Remove Auto-Punishment Rule')
            .setDescription('Select a rule to delete. This action cannot be undone.')
            .addFields({ name: 'Tip', value: 'You can re-add a rule later with Add Rule.' })
            .setColor('#EF4444')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] });
        return;
    }

    if (customId === 'automod_select_remove') {
        await safeDefer(interaction, true);
        const ruleOrder = parseInt(values[0], 10);
        await db.query('DELETE FROM automod_rules WHERE guildid = $1 AND rule_order = $2', [guildId, ruleOrder]);
        
        if (generateSetupContent) {
            const { embed, components } = await generateSetupContent(interaction, guildId);
            await interaction.editReply({ content: null, embeds: [success(`Rule deleted.`), embed], components });
        } else await interaction.editReply({ embeds: [success('Deleted.')] });
        return;
    }

    if (customId === 'automod_duration_select') {
        const [durationValue, warnCountStr, actionType] = values[0].split(':');
        const warnCount = parseInt(warnCountStr, 10);

        if (durationValue === 'CUSTOM') {
            const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            const modal = new ModalBuilder()
                .setCustomId(`automod_duration_custom_modal:${warnCountStr}:${actionType}`)
                .setTitle('Custom Duration');

            const label = actionType === 'BAN'
                ? 'Duration (0 for Permanent)'
                : 'Timeout Duration (Max 28 days)';

            const placeholder = actionType === 'BAN'
                ? '0, 7d, 30d, 1y...'
                : '10m, 1h, 2d, 28d...';

            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('duration_value')
                    .setLabel(label)
                    .setPlaceholder(placeholder)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ));

            await interaction.showModal(modal);
            return;
        }

        if (!await safeDefer(interaction, true)) return;
        const finalDuration = durationValue === 'PERM' ? null : durationValue;

        await saveRule(db, guildId, warnCount, actionType, finalDuration);

        if (generateSetupContent) {
            const { embed, components } = await generateSetupContent(interaction, guildId);
            await interaction.editReply({ content: null, embeds: [success(`Auto-Punishment Saved: **${warnCount} Warns -> ${actionType}** (${finalDuration || 'Permanent'})`), embed], components });
        } else await interaction.editReply({ embeds: [success('Saved.')] });
        return;
    }

    if (interaction.isModalSubmit && customId.startsWith('automod_duration_custom_modal:')) {
        if (!await safeDefer(interaction, true)) return;
        const [, warnCountStr, actionType] = customId.split(':');
        const durationStr = interaction.fields.getTextInputValue('duration_value').trim();
        const warnCount = parseInt(warnCountStr, 10);

        let finalDuration = durationStr;
        const msDuration = ms(durationStr);

        if (actionType === 'BAN') {
            if (durationStr === '0') {
                finalDuration = null;
            } else {
                if (!msDuration || msDuration <= 0) {
                    return interaction.editReply({ embeds: [error('Invalid duration. Use format like 7d, 24h, or 0 for Permanent.')] });
                }
                finalDuration = durationStr;
            }
        } else if (actionType === 'MUTE') {
            if (!msDuration) {
                return interaction.editReply({ embeds: [error('Invalid duration. Use format like 10m, 1h, 1d.')] });
            }
            if (msDuration < 10000) {
                return interaction.editReply({ embeds: [error('Too short. Minimum timeout is 10 seconds.')] });
            }
            if (msDuration > 2419200000) {
                return interaction.editReply({ embeds: [error('Too long. Discord timeouts cannot exceed 28 days.')] });
            }
            finalDuration = durationStr;
        }

        await saveRule(db, guildId, warnCount, actionType, finalDuration);

        if (generateSetupContent) {
            const { embed, components } = await generateSetupContent(interaction, guildId);
            await interaction.editReply({ content: null, embeds: [success(`Auto-Punishment Saved: **${warnCount} Warns -> ${actionType}** (${finalDuration || 'Permanent'})`), embed], components });
        } else await interaction.editReply({ embeds: [success('Saved.')] });
        return;
    }
};

async function saveRule(db, guildId, warnCount, actionType, duration) {
    const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
    const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;

    await db.query(`
        INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) 
        VALUES ($1, $2, $3, $4, $5) 
        ON CONFLICT (guildid, warnings_count) 
        DO UPDATE SET 
            action_type = EXCLUDED.action_type, 
            action_duration = EXCLUDED.action_duration
    `, [guildId, nextRuleOrder, warnCount, actionType, duration]);
}
