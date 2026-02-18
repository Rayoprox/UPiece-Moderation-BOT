const fs = require('fs');
const path = require('path');

const LISTS_DIR = path.join(__dirname, '..', 'data', 'vpn-lists');
const VPN_FILE = path.join(LISTS_DIR, 'vpn.txt');
const DC_FILE = path.join(LISTS_DIR, 'datacenter.txt');
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 horas

class VPNDetector {
    constructor() {
        this.vpnRanges = [];
        this.datacenterRanges = [];
        this.lastUpdate = 0;
        this.loading = false;
        this.ready = false;
    }

    // ── IP / CIDR helpers ──

    ipToLong(ip) {
        const parts = ip.trim().split('.');
        if (parts.length !== 4) return null;
        let result = 0;
        for (const octet of parts) {
            const n = parseInt(octet, 10);
            if (isNaN(n) || n < 0 || n > 255) return null;
            result = (result * 256) + n;
        }
        return result >>> 0;
    }

    cidrToRange(cidr) {
        const parts = cidr.trim().split('/');
        if (parts.length !== 2) return null;
        const ip = this.ipToLong(parts[0]);
        if (ip === null) return null;
        const bits = parseInt(parts[1], 10);
        if (isNaN(bits) || bits < 0 || bits > 32) return null;
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        const start = (ip & mask) >>> 0;
        const end = (start | (~mask >>> 0)) >>> 0;
        return { start, end };
    }

    // ── Descarga de listas ──

    async downloadLists() {
        if (!fs.existsSync(LISTS_DIR)) {
            fs.mkdirSync(LISTS_DIR, { recursive: true });
        }

        const sources = {
            'vpn.txt': 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt',
            'datacenter.txt': 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt'
        };

        for (const [file, url] of Object.entries(sources)) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (res.ok) {
                    const text = await res.text();
                    const lines = text.split('\n').filter(l => l.trim() && l.includes('/'));
                    fs.writeFileSync(path.join(LISTS_DIR, file), lines.join('\n'));
                    console.log(`[VPN-DETECTOR] ✅ Downloaded ${file} — ${lines.length} ranges`);
                } else {
                    console.warn(`[VPN-DETECTOR] ⚠️ Failed to download ${file}: HTTP ${res.status}`);
                }
            } catch (err) {
                console.error(`[VPN-DETECTOR] ❌ Error downloading ${file}:`, err.message);
            }
        }
    }

    // ── Carga de listas en memoria ──

    parseFile(filePath) {
        if (!fs.existsSync(filePath)) return [];
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
        const ranges = [];
        for (const line of lines) {
            const range = this.cidrToRange(line);
            if (range) ranges.push(range);
        }
        // Ordenar por start para búsqueda binaria
        ranges.sort((a, b) => a.start - b.start);
        return ranges;
    }

    async loadLists() {
        if (this.loading) return;
        this.loading = true;

        try {
            const now = Date.now();
            const needsDownload = !fs.existsSync(VPN_FILE) || !fs.existsSync(DC_FILE) ||
                (now - this.lastUpdate > UPDATE_INTERVAL);

            if (needsDownload) {
                await this.downloadLists();
            }

            this.vpnRanges = this.parseFile(VPN_FILE);
            this.datacenterRanges = this.parseFile(DC_FILE);
            this.lastUpdate = now;
            this.ready = true;

            console.log(`[VPN-DETECTOR] ✅ Loaded ${this.vpnRanges.length} VPN + ${this.datacenterRanges.length} datacenter ranges`);
        } catch (err) {
            console.error('[VPN-DETECTOR] ❌ Error loading lists:', err);
        } finally {
            this.loading = false;
        }
    }

    // ── Búsqueda binaria O(log n) ──

    isInRanges(ipLong, ranges) {
        let low = 0;
        let high = ranges.length - 1;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            const r = ranges[mid];

            if (ipLong < r.start) {
                high = mid - 1;
            } else if (ipLong > r.end) {
                low = mid + 1;
            } else {
                return true;
            }
        }
        return false;
    }

    // ── API pública ──

    /**
     * Verifica si una IP es VPN o datacenter.
     * @param {string} ip - Dirección IPv4
     * @returns {{ isVPN: boolean, isDatacenter: boolean, blocked: boolean }}
     */
    check(ip) {
        if (!this.ready) {
            return { isVPN: false, isDatacenter: false, blocked: false, reason: 'not_ready' };
        }

        // Limpiar IP (quitar ::ffff: de IPv4-mapped IPv6)
        const cleanIp = ip.replace(/^::ffff:/, '');
        const ipLong = this.ipToLong(cleanIp);

        if (ipLong === null) {
            return { isVPN: false, isDatacenter: false, blocked: false, reason: 'invalid_ip' };
        }

        // No bloquear IPs privadas/localhost
        if (this.isPrivateIP(ipLong)) {
            return { isVPN: false, isDatacenter: false, blocked: false, reason: 'private_ip' };
        }

        const isVPN = this.isInRanges(ipLong, this.vpnRanges);
        const isDatacenter = this.isInRanges(ipLong, this.datacenterRanges);

        return {
            isVPN,
            isDatacenter,
            blocked: isVPN || isDatacenter,
            reason: isVPN ? 'vpn' : isDatacenter ? 'datacenter' : 'clean'
        };
    }

    /**
     * Comprueba si es IP privada (localhost, LAN)
     */
    isPrivateIP(ipLong) {
        // 10.0.0.0/8
        if (ipLong >= 167772160 && ipLong <= 184549375) return true;
        // 172.16.0.0/12
        if (ipLong >= 2886729728 && ipLong <= 2887778303) return true;
        // 192.168.0.0/16
        if (ipLong >= 3232235520 && ipLong <= 3232301055) return true;
        // 127.0.0.0/8
        if (ipLong >= 2130706432 && ipLong <= 2147483647) return true;
        return false;
    }

    /**
     * Estadísticas del detector
     */
    stats() {
        return {
            ready: this.ready,
            vpnRanges: this.vpnRanges.length,
            datacenterRanges: this.datacenterRanges.length,
            lastUpdate: this.lastUpdate ? new Date(this.lastUpdate).toISOString() : 'never'
        };
    }
}

// Singleton
const detector = new VPNDetector();

module.exports = detector;
