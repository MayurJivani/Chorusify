/**
 * Estimates this device's clock offset from the server's: server time minus local time.
 *
 * From one ping the offset is `serverNow - (sentAt + rtt / 2)`, assuming the two directions took
 * equal time. The sample with the lowest round trip has the least room for that to be wrong, so it
 * is the one kept.
 */
export function createClockSync() {
  let best = { rtt: Infinity, offset: 0 };
  return {
    addSample(sentAt: number, receivedAt: number, serverNow: number) {
      const rtt = receivedAt - sentAt;
      if (rtt < 0 || rtt >= best.rtt) return;
      best = { rtt, offset: serverNow - (sentAt + rtt / 2) };
    },
    /** A server timestamp as a time on this device's clock. */
    toLocal: (serverTime: number) => serverTime - best.offset,
    offset: () => best.offset,
  };
}
