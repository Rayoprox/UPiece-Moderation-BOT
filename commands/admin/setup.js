const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, ChannelType, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');
const TIMEOUT = 300_000; // 5 Minutos

const generateSetupContent = async (interaction, guildId) => {
    // Queries paralelas para eficiencia
    const [logChannelsResult, guildSettingsResult, permissionsResult, rulesResult, antiNukeResult] = await Promise.all([
        db.query('SELECT * FROM log_channels WHERE guildid = $1', [guildId]),
        db.query('SELECT * FROM guild_settings WHERE guildid = $1', [guildId]),
        db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name', [guildId]),
        db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]),
        db.query('SELECT antinuke_enabled, threshold_count, threshold_time FROM guild_backups WHERE guildid = $1', [guildId])
    ]);
    
    const logChannels = logChannelsResult.rows;
    const guildSettings = guildSettingsResult.rows[0] || {};
    const permissions = permissionsResult.rows;
    const rules = rulesResult.rows;
    const antiNukeSettings = antiNukeResult.rows[0] || {};
    
    const ruleSummary = rules.map(rule => `**#${rule.rule_order}**: ${rule.warnings_count} warns -> **${rule.action_type}**${rule.action_duration ? ` (${rule.action_duration})` : ''}`).join('\n') || '*No Automod rules set.*';
    const modLog = logChannels.find(c => c.log_type === 'modlog')?.channel_id;
    const cmdLog = logChannels.find(c => c.log_type === 'cmdlog')?.channel_id;
    const banAppeal = logChannels.find(c => c.log_type === 'banappeal')?.channel_id;
    const antiNukeLog = logChannels.find(c => c.log_type === 'antinuke')?.channel_id;
    const staffRoles = guildSettings.staff_roles ? guildSettings.staff_roles.split(',').map(r => `<@&${r}>`).join(', ') : 'Not Set';
    const isAntiNukeOn = antiNukeSettings.antinuke_enabled;

    const permsConfig = Object.entries(permissions.reduce((acc, p) => {
        (acc[p.command_name] = acc[p.command_name] || []).push(`<@&${p.role_id}>`);
        return acc;
    }, {})).map(([cmd, roles]) => `\`/${cmd}\`: ${roles.join(', ')}`).join('\n') || 'No custom permissions set.';
    
   const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`)
        .setDescription(`Configure the bot using the buttons below.`)
        .addFields(
            { name: `${emojis.channel} Log Channels`, value: `**Mod Log:** ${modLog ? `<#${modLog}>` : '❌'}\n**Command Log:** ${cmdLog ? `<#${cmdLog}>` : '❌'}\n**Ban Appeals:** ${banAppeal ? `<#${banAppeal}>` : '❌'}\n**Anti-Nuke:** ${antiNukeLog ? `<#${antiNukeLog}>` : '❌'}` },
            { name: `${emojis.role} Roles`, value: `**Staff Roles:** ${staffRoles}` }, 
            { name: `${emojis.lock} Permissions`, value: permsConfig },
            { name: `${emojis.rules} Automod Rules`, value: ruleSummary },
            { name: '☢️ Anti-Nuke', value: isAntiNukeOn ? `✅ **ENABLED**` : '❌ **DISABLED**' }
        );

    const mainRows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels').setLabel('Log Channels').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Staff Roles').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_permissions').setLabel('Permissions').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod').setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Anti-Nuke').setStyle(isAntiNukeOn ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('delete_all_data').setLabel('Reset Data').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_setup').setLabel('Close').setStyle(ButtonStyle.Secondary)
        )
    ];
    
    return { embed, components: mainRows };
};

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder().setName('setup').setDescription('Opens the setup panel.').setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    generateSetupContent, // Exportamos para usar en interactionCreate si hace falta

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const { embed: mainEmbed, components: mainComponents } = await generateSetupContent(interaction, guildId);

        const response = await interaction.editReply({ embeds: [mainEmbed], components: mainComponents });

        // --- FILTRO CRÍTICO ---
        // Solo estos IDs serán manejados por ESTE collector. El resto (antinuke, automod rules, selects) pasan a interactionCreate.js
        const handledIds = [
            'cancel_setup', 'delete_all_data', 'setup_back_to_main',
            'setup_channels', 'set_modlog', 'set_cmdlog', 'set_banappeal',
            'setup_staff_roles',
            'setup_permissions',
            'setup_automod' // Solo la entrada al menú, no las reglas internas
        ];

        const collector = response.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: "❌ Only the command author can use this menu.", flags: [MessageFlags.Ephemeral] });

            // SI EL BOTÓN NO ES DE NAVEGACIÓN, LO IGNORAMOS (Para que interactionCreate lo capture)
            if (!handledIds.includes(i.customId)) return;

            // Deferimos solo si es nuestro
            try { await i.deferUpdate(); } catch (e) { return; }

            switch (i.customId) {
                case 'cancel_setup':
                    await i.editReply({ content: 'Setup closed.', embeds: [], components: [] }); 
                    return collector.stop();
                    
                case 'delete_all_data':
                    await Promise.all([
                        db.query('DELETE FROM log_channels WHERE guildid = $1', [guildId]),
                        db.query('DELETE FROM guild_settings WHERE guildid = $1', [guildId]),
                        db.query('DELETE FROM command_permissions WHERE guildid = $1', [guildId]),
                        db.query('DELETE FROM automod_rules WHERE guildid = $1', [guildId]),
                        db.query('DELETE FROM guild_backups WHERE guildid = $1', [guildId])
                    ]);
                    await i.editReply({ content: '✅ Server configuration reset.', embeds: [], components: [] });
                    return collector.stop();
                    
                case 'setup_channels': {
                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('set_modlog').setLabel('Mod Log').setStyle(ButtonStyle.Secondary), 
                        new ButtonBuilder().setCustomId('set_cmdlog').setLabel('Cmd Log').setStyle(ButtonStyle.Secondary), 
                        new ButtonBuilder().setCustomId('set_banappeal').setLabel('Appeals').setStyle(ButtonStyle.Secondary)
                    );
                    const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('📺 Log Channels').setDescription('Select a log type.')], components: [buttons, back] });
                    break;
                }
                
                case 'setup_staff_roles': {
                    const settings = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
                    const current = settings.rows[0]?.staff_roles?.split(',').filter(Boolean).length || 0;
                    const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Select staff roles...').setMinValues(0).setMaxValues(20);
                    const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('👑 Staff Roles').setDescription(`Roles immune to automod. Selected: ${current}`)], components: [new ActionRowBuilder().addComponents(menu), back] });
                    break;
                }
                
                case 'setup_permissions': {
                    const cmds = Array.from(interaction.client.commands.keys()).filter(c => !['setup','help','ping'].includes(c)).map(c => ({ label: `/${c}`, value: c }));
                    const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command...').addOptions(cmds);
                    const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('🛡️ Permissions').setDescription('Limit commands to specific roles.')], components: [new ActionRowBuilder().addComponents(menu), back] });
                    break;
                }
                
                case 'setup_automod': {
                    const { embed } = await generateSetupContent(interaction, guildId);
                    const rulesField = embed.data.fields.find(f => f.name.includes('Automod Rules'));
                    const rulesEmbed = new EmbedBuilder().setTitle('🤖 Automod Rules').setDescription(rulesField ? rulesField.value : 'No rules.').setColor(0x2ECC71);
                    const actions = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('automod_add_rule').setLabel('Add Rule').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('automod_remove_rule').setLabel('Remove Rule').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
                    );
                    await i.editReply({ embeds: [rulesEmbed], components: [actions] });
                    break;
                }
                
                case 'setup_back_to_main': {
                    const { embed, components } = await generateSetupContent(interaction, guildId);
                    await i.editReply({ embeds: [embed], components });
                    break;
                }
                
                case 'set_modlog': case 'set_cmdlog': case 'set_banappeal': {
                    const type = i.customId.replace('set_', '');
                    const menu = new ChannelSelectMenuBuilder().setCustomId(`select_${type}_channel`).setPlaceholder('Select channel...').addChannelTypes(ChannelType.GuildText);
                    const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle(`Set ${type} Channel`)], components: [new ActionRowBuilder().addComponents(menu), back] });
                    break;
                }
            }
        });

        collector.on('end', () => interaction.editReply({ content: 'Setup expired.', components: [] }).catch(() => {}));
    },
};