// "Recently viewed" people for the sidebar, kept in this browser per staff member.
export type Recent = { kind: 'lead' | 'candidate'; id: string; name: string };
const key = (staffId: string) => 'stint-recent:' + staffId;
export function readRecent(staffId: string): Recent[] {
  try { return JSON.parse(localStorage.getItem(key(staffId)) || '[]'); } catch { return []; }
}
export function trackRecent(staffId: string, r: Recent) {
  try {
    const list = [r, ...readRecent(staffId).filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, 5);
    localStorage.setItem(key(staffId), JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('stint:recent'));
  } catch {}
}
