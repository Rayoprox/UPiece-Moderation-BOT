
const cache = new Map();

module.exports = {

    get: (guildId) => {
        const data = cache.get(guildId);
        if (!data) return null;
        if (Date.now() > data.expiresAt) {
            cache.delete(guildId);
            return null;
        }
        return data.value;
    },

 
    set: (guildId, value, ttlSeconds = 300) => {
        cache.set(guildId, {
            value,
            expiresAt: Date.now() + (ttlSeconds * 1000)
        });
    },

  
    flush: (guildId) => {
        if (cache.has(guildId)) {
            cache.delete(guildId);
       
        }
    }
};
