const { EmbedBuilder } = require('discord.js');

async function resolveArgument(guild, type, content) {
    if (!content) return null;

    switch (type) {
        case 6: 
            const userMatch = content.match(/^<@!?(\d+)>$/) || content.match(/^(\d{17,19})$/);
            if (userMatch) {
                try {
                    return await guild.client.users.fetch(userMatch[1]).catch(() => null);
                } catch (e) { return null; }
            }
            return null;

        case 7: 
            const channelMatch = content.match(/^<#(\d+)>$/) || content.match(/^(\d{17,19})$/);
            if (channelMatch) return guild.channels.cache.get(channelMatch[1]) || null;
            return null;
        
        case 8: 
          
            const roleMatch = content.match(/^<@&(\d+)>$/) || content.match(/^(\d{17,19})$/);
            if (roleMatch) return guild.roles.cache.get(roleMatch[1]) || null;

           
            const search = content.toLowerCase();
            const rolesCache = guild.roles.cache;

           
            const exactMatch = rolesCache.find(r => r.name.toLowerCase() === search);
            if (exactMatch) return exactMatch;

            
            if (search.length < 2) return null; 

            
            const matches = rolesCache.filter(r => 
                r.name.toLowerCase().includes(search) && r.name !== '@everyone'
            );

            if (!matches.size) return null;

           
            const sortedMatches = matches.sort((roleA, roleB) => {
                const nameA = roleA.name.toLowerCase();
                const nameB = roleB.name.toLowerCase();
                const startsA = nameA.startsWith(search);
                const startsB = nameB.startsWith(search);

                
                if (startsA && !startsB) return -1;
                if (!startsA && startsB) return 1;

                
                return nameA.length - nameB.length;
            });

            return sortedMatches.first();

        case 4:
            const intVal = parseInt(content);
            return isNaN(intVal) ? null : intVal;

        case 10: 
            const numVal = parseFloat(content);
            return isNaN(numVal) ? null : numVal;
            
        case 5: 
            const lower = content.toLowerCase();
            return (lower === 'true' || lower === 'yes' || lower === 'si' || lower === 'on' || lower === '1') ? true : 
                   (lower === 'false' || lower === 'no' || lower === 'off' || lower === '0') ? false : null;

        case 3: 
        default:
            return content;
    }
}

class PrefixInteraction {
    constructor(message, commandName, resolvedOptions, subcommand = null) {
        this.message = message;
        this.user = message.author;
        this.member = message.member;
        this.guild = message.guild;
        this.channel = message.channel;
        this.client = message.client;
        this.commandName = commandName;
        this.id = message.id;
        this.createdTimestamp = message.createdTimestamp;
        
        this.replied = false;
        this.deferred = false;
        this.replyMessage = null;

    
        this.type = 2; 
        this.commandType = 1;

        this.options = {
            _hoistedOptions: resolvedOptions,
            getUser: (name) => this._getOption(name),
            getMember: (name) => this._getOption(name),
            getChannel: (name) => this._getOption(name),
            getRole: (name) => this._getOption(name),
            getString: (name) => this._getOption(name),
            getInteger: (name) => this._getOption(name),
            getBoolean: (name) => this._getOption(name),
            getNumber: (name) => this._getOption(name),
            getSubcommand: () => subcommand
        };
    }

    _getOption(name) { return this.options._hoistedOptions[name] || null; }

    async deferReply({ ephemeral } = {}) {
        this.deferred = true;
    
        return this.message; 
    }
    
    async deferUpdate() { return this.deferReply(); }

    async editReply(content) {
        if (!this.replyMessage) return this.reply(content);
        this.replied = true;
        if (typeof content === 'string') content = { content };
        if (content.embeds && !content.content) content.content = null;
        return this.replyMessage.edit(content);
    }

    async reply(content) {
        if (this.deferred && this.replyMessage) return this.editReply(content);
        this.replied = true;
        
        try {
      
            this.replyMessage = await this.message.reply(content);
        } catch (err) {
            
            if (err.code === 10008 || err.code === 50035) {
      
                this.replyMessage = await this.channel.send(content).catch(e => console.error("[PREFIX] Send failed:", e));
            } else {
                console.error("[PREFIX] Reply failed:", err);
            }
        }
        return this.replyMessage;
    }

    async followUp(content) { 

        return this.channel.send(content).catch(console.error);
    }
    
    async deleteReply() { if (this.replyMessage?.deletable) return this.replyMessage.delete().catch(()=>{}); }
    async fetchReply() { return this.replyMessage || this.message; }

    isRepliable() { return true; }
    isChatInputCommand() { return true; } 
    
    toString() { return this.message.content; }
}

module.exports = { resolveArgument, PrefixInteraction };
