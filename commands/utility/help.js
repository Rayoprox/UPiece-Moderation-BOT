const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'all',
    isPublic: true, 

    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays a list of commands you can use.'),

    async execute(interaction) {
        const { client, user, guild } = interaction;
        const commands = client.commands; 
        const member = interaction.member;
        const guildId = guild.id;

        const book = emojis?.book || '📖';
        const commandCategories = { admin: [], utility: [], appeal: [] };
        
        const allPermissionsResult = await db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guildId]);
        const permMap = allPermissionsResult.rows.reduce((acc, row) => {
            if (!acc[row.command_name]) acc[row.command_name] = [];
            acc[row.command_name].push(row);
            return acc;
        }, {});
    
        for (const command of commands.values()) {
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
                let commandHeader = `> **/${command.data.name}**`;
                if (options.length > 0) commandHeader += ` \`${options.join(' ')}\``;
                const formattedCommand = `${commandHeader}\n> *${command.data.description}*`;

                switch(command.deploy) {
                    case 'main':
                        if (['ban', 'kick', 'mute', 'unmute', 'modlogs', 'warnings', 'purge', 'reason', 'void', 'warn', 'unban', 'blmanage', 'setup', 'lock', 'unlock', 'softban', 'case', 'whois', 'lockdown', 'unlockdown', 'slowmode'].includes(command.data.name)) {
                            commandCategories.admin.push(formattedCommand);
                        } else {
                            commandCategories.utility.push(formattedCommand);
                        }
                        break;
                    case 'appeal':
                        commandCategories.appeal.push(formattedCommand);
                        break;
                    case 'all':
                         if (command.data.name !== 'help') commandCategories.utility.push(formattedCommand);
                        break;
                }
            }
        }

        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${book} ${guild.name} Help Menu`) 
            .setDescription(`Here is a comprehensive list of commands available to **${user.username}** in **${guild.name}**.`)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ 
                text: `Requested by ${user.username} • Dev by @ukirama`, 
                iconURL: user.displayAvatarURL({ dynamic: true }) 
            })
            .setTimestamp();

        const addSplitFields = (embed, title, items) => {
            if (!items || items.length === 0) return;
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
        };

        addSplitFields(helpEmbed, `${emojis?.staff || '🛡️'} Moderation & Admin`, commandCategories.admin);
        addSplitFields(helpEmbed, `${emojis?.utils || '🛠️'} Utility & Tools`, commandCategories.utility);
        addSplitFields(helpEmbed, `${emojis?.appeal || '📨'} Appeal System`, commandCategories.appeal);

        if (!helpEmbed.data.fields || helpEmbed.data.fields.length === 0) {
            helpEmbed.setDescription(`${emojis?.cross || '❌'} **No commands available.**\nYou do not have permission to view or use any commands here.`);
            helpEmbed.setColor(0xE74C3C);
        }

        await interaction.editReply({ embeds: [helpEmbed] });
    },
};