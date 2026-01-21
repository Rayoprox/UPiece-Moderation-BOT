const { Events } = require('discord.js');
const db = require('../utils/db.js');
const { resolveArgument, PrefixInteraction } = require('../utils/prefixShim.js');
const { error } = require('../utils/embedFactory.js');
const guildCache = require('../utils/guildCache.js');

const { validateCommandPermissions, sendCommandLog } = require('../utils/logicHelper.js');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const { guild, author, member } = message;

        let guildData = guildCache.get(guild.id);
        if (!guildData || !guildData.settings) {
            const settingsRes = await db.query('SELECT prefix FROM guild_settings WHERE guildid = $1', [guild.id]);
            if (!guildData) guildData = { settings: {}, permissions: [] };
            guildData.settings = settingsRes.rows[0] || { prefix: '!' };
            guildCache.set(guild.id, guildData);
        }
        const SERVER_PREFIX = guildData.settings.prefix || '!';

        if (!message.content.startsWith(SERVER_PREFIX)) return;
        const args = message.content.slice(SERVER_PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = message.client.commands.get(commandName);

        if (!command) return;

        const result = await validateCommandPermissions(
            message.client, 
            guild, 
            member, 
            author, 
            commandName, 
            db
        );

        if (!result.valid) {
            return message.reply({ embeds: [error(result.reason)] });
        }

        const resolvedOptions = {};
        const definedOptions = command.data.options || [];
        
        for (let i = 0; i < definedOptions.length; i++) {
            const optionDef = definedOptions[i];
            let rawArg = args[i];

            if (i === definedOptions.length - 1 && optionDef.type === 3 && args.length > i) {
                rawArg = args.slice(i).join(' ');
            }
            if (optionDef.required && !rawArg) {
                return message.reply({ embeds: [error(`Missing required argument: **${optionDef.name}**`)] });
            }
            if (rawArg) {
                const resolvedValue = await resolveArgument(message.guild, optionDef.type, rawArg);
                if (resolvedValue === null && optionDef.required) {
                     return message.reply({ embeds: [error(`Invalid argument for **${optionDef.name}**. Expected: ${optionDef.description}`)] });
                }
                if (resolvedValue !== null) resolvedOptions[optionDef.name] = resolvedValue;
            }
        }

    
        try {
            const interactionShim = new PrefixInteraction(message, commandName, resolvedOptions);
            await command.execute(interactionShim);
            
     
            await sendCommandLog(interactionShim, db, result.isAdmin).catch(() => {});
        } catch (err) {
            console.error(`Error processing prefix command ${commandName}:`, err);
            message.reply({ embeds: [error("An error occurred while executing this command.")] }).catch(()=>{});
        }
    },
};