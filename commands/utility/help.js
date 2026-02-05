const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis, STAFF_COMMANDS } = require('../../utils/config.js');

module.exports = {
    deploy: 'all',
    isPublic: false, 

    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays a list of commands you can use.'),

    async execute(interaction) {
        const { client, user, guild } = interaction;
        const commands = client.commands; 
        const member = interaction.member;
        const guildId = guild.id;

        const settingsRes = await db.query('SELECT prefix FROM guild_settings WHERE guildid = $1', [guildId]);
        const prefix = settingsRes.rows[0]?.prefix || '!';

        const book = emojis?.book || '📖';
        const commandCategories = { moderation: [], administrator: [], utility: [], appeal: [], tickets: [] };
        
        const allPermissionsResult = await db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guildId]);
        const permMap = allPermissionsResult.rows.reduce((acc, row) => {
            if (!acc[row.command_name]) acc[row.command_name] = [];
            acc[row.command_name].push(row);
            return acc;
        }, {});
    
        for (const command of commands.values()) {
            if (command.category === 'developer') continue; // hide developer commands
            let hasPermission = member.permissions.has(PermissionsBitField.Flags.Administrator);
            
            if (!hasPermission) {
                const allowedRoles = permMap[command.data.name] || [];
                if (allowedRoles.length > 0) {
                    hasPermission = member.roles.cache.some(role => allowedRoles.some(rule => rule.role_id === role.id));
                } else if (command.data.default_member_permissions) {
                    hasPermission = member.permissions.has(command.data.default_member_permissions);
                } else if (command.isPublic || !command.adminOnly) {
                    hasPermission = true; 
                }
            }

                if (hasPermission) {
                const options = command.data.options.map(opt => opt.required ? `<${opt.name}>` : `[${opt.name}]`);
                const argsString = options.length > 0 ? ` \`${options.join(' ')}\`` : '';
                
                const commandHeader = `> **/${command.data.name}** | **${prefix}${command.data.name}**${argsString}`;
                const formattedCommand = `${commandHeader}\n> *${command.data.description}*`;

                if (STAFF_COMMANDS.includes(command.data.name)) {
                    commandCategories.moderation.push(formattedCommand);
                } else if (command.category === 'tickets' || command.data.name === 'ticket') {
                    commandCategories.tickets.push(formattedCommand);
                } else if (command.deploy === 'appeal') {
                    commandCategories.appeal.push(formattedCommand);
                } else if (command.deploy === 'main') {
                    commandCategories.administrator.push(formattedCommand);
                } else {
                    if (command.data.name !== 'help') commandCategories.utility.push(formattedCommand);
                }
            }
        }

        const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

        const mainEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${book} ${guild.name} Help Menu`)
            .setDescription(`Sections:\n• Moderation & Admin\n• Utility & Tools\n• Appeal System\n\nSelect a section from the menu below to view its commands.`)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: `Prefix: ${prefix} • Requested by ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        const sections = [
            { label: 'Moderation', value: 'moderation', description: 'Kick, Ban, Mute and more' },
            { label: 'Administrator', value: 'administrator', description: 'Server admin commands' },
            { label: 'Utility & Tools', value: 'utility', description: 'Ping, Help, Info and helpers' },
            { label: 'Tickets', value: 'tickets', description: 'Open and manage support tickets' },
            { label: 'Appeal System', value: 'appeal', description: 'Ban appeal related commands' }
        ];

        const select = new StringSelectMenuBuilder()
            .setCustomId('help_select')
            .setPlaceholder('Choose a section...')
            .addOptions(sections.map(s => ({ label: s.label, value: s.value, description: s.description })));

        const row = new ActionRowBuilder().addComponents(select);
        const { ButtonBuilder, ButtonStyle } = require('discord.js');
        const backButton = new ButtonBuilder().setCustomId('help_back').setLabel('Back').setStyle(ButtonStyle.Secondary);
        const backRow = new ActionRowBuilder().addComponents(backButton);

        const formatListToEmbed = (title, items) => {
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(title)
                .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setFooter({ text: `Prefix: ${prefix} • Requested by ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            if (!items || items.length === 0) {
                embed.setDescription(`${emojis?.cross || '❌'} **No commands available in this section.**`);
                embed.setColor(0xE74C3C);
                return embed;
            }

            let currentText = '';
            let isFirstField = true;
            for (const item of items) {
                if (currentText.length + item.length + 2 > 1024) {
                    embed.addFields({ name: isFirstField ? title : `${title} (Cont.)`, value: currentText });
                    currentText = item;
                    isFirstField = false;
                } else {
                    currentText = currentText.length > 0 ? currentText + '\n\n' + item : item;
                }
            }
            if (currentText.length > 0) embed.addFields({ name: isFirstField ? title : `${title} (Cont.)`, value: currentText });
            return embed;
        };

        const isPrefix = !!interaction.message;

        let msg;
        if (isPrefix) {
            try {
                msg = await interaction.user.send({ embeds: [mainEmbed], components: [row] });
            } catch (e) {
                msg = await interaction.reply({ embeds: [mainEmbed], components: [row], fetchReply: true }).catch(() => null);
            }
        } else {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [mainEmbed], components: [row] });
                msg = await interaction.fetchReply();
            } else {
                msg = await interaction.reply({ embeds: [mainEmbed], components: [row], ephemeral: true, fetchReply: true });
            }
        }

        const filter = i => i.user.id === interaction.user.id && (i.customId === 'help_select' || i.customId === 'help_back');
        const collector = msg?.createMessageComponentCollector ? msg.createMessageComponentCollector({ filter, time: 120000 }) : null;

        if (collector) collector.on('collect', async i => {
            if (i.customId === 'help_back') {
                await i.update({ embeds: [mainEmbed], components: [row] });
                return;
            }
            const choice = i.values[0];
            if (choice === 'moderation') {
                const emb = formatListToEmbed(`${emojis?.staff || '🛡️'} Moderation`, commandCategories.moderation);
                await i.update({ embeds: [emb], components: [row, backRow] });
            } else if (choice === 'administrator') {
                const emb = formatListToEmbed(`⚙️ Administrator`, commandCategories.administrator);
                await i.update({ embeds: [emb], components: [row, backRow] });
            } else if (choice === 'utility') {
                const emb = formatListToEmbed(`${emojis?.utils || '🛠️'} Utility & Tools`, commandCategories.utility);
                await i.update({ embeds: [emb], components: [row, backRow] });
            } else if (choice === 'appeal') {
                const emb = formatListToEmbed(`${emojis?.appeal || '📨'} Appeal System`, commandCategories.appeal);
                await i.update({ embeds: [emb], components: [row, backRow] });
            } else if (choice === 'tickets') {
                const emb = formatListToEmbed(`🎫 Tickets`, commandCategories.tickets);
                await i.update({ embeds: [emb], components: [row, backRow] });
            } else {
                await i.update({ content: 'Unknown section.', components: [] });
            }
        });
    },
};