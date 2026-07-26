// FSL-1.1-Apache-2.0 — see LICENSE

import { execFileSync } from 'child_process';

// Fingerprint the current network by its default gateway's IP + MAC address.
// The MAC is the strong part: it's unique to your router and a passive sniffer
// on a coffee-shop LAN can't make their gateway look like your home router.
// LAN peering only activates when this fingerprint matches the one recorded
// when you enabled it at home — so at a hotel/cafe the peer listener never
// opens in the first place.

function defaultGatewayIp() {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8', timeout: 3000 });
      const m = out.match(/gateway:\s*([\d.]+)/);
      return m ? m[1] : null;
    }
    // linux
    const out = execFileSync('ip', ['route'], { encoding: 'utf8', timeout: 3000 });
    const m = out.match(/default via ([\d.]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function macForIp(ip) {
  if (!ip) return null;
  try {
    const arp = process.platform === 'darwin' ? ['-n', ip] : ['-n', ip];
    const out = execFileSync('arp', arp, { encoding: 'utf8', timeout: 3000 });
    // e.g. "? (10.0.0.1) at 5c:7d:7d:2d:11:e0 on en0 …"
    const m = out.match(/([0-9a-f]{1,2}(:[0-9a-f]{1,2}){5})/i);
    return m ? normalizeMac(m[1]) : null;
  } catch { return null; }
}

function normalizeMac(mac) {
  // ARP can print "5:7d:..." (no leading zero) — pad each octet so equality is reliable.
  return mac.toLowerCase().split(':').map((o) => o.padStart(2, '0')).join(':');
}

// { gatewayIp, gatewayMac } for the network we're on right now, or nulls.
export function currentNetworkFingerprint() {
  const gatewayIp = defaultGatewayIp();
  const gatewayMac = macForIp(gatewayIp);
  return { gatewayIp, gatewayMac };
}

// Are we on the trusted network? Requires a MAC match — an IP-only match is not
// enough (many LANs use 192.168.1.1). If no fingerprint was ever recorded, we
// are NOT on a trusted network (fail closed).
export function onTrustedNetwork(trusted) {
  if (!trusted || !trusted.gatewayMac) return false;
  const now = currentNetworkFingerprint();
  return !!now.gatewayMac && now.gatewayMac === normalizeMac(trusted.gatewayMac);
}
