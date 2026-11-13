export interface Identity {
  id: string;
  name: string;
  color: string;
}

// Thread colours: each collaborator's caret and avatar.
const COLORS = ["#e4572e", "#17bebb", "#7b5ea7", "#2e86ab", "#d99a00", "#4f9d69", "#d1495b", "#3d5a80"];
const ADJECTIVES = ["Quiet", "Brisk", "Amber", "Plucky", "Lucid", "Steady", "Nimble", "Wry"];
const ANIMALS = ["Heron", "Otter", "Finch", "Lynx", "Marten", "Wren", "Ibex", "Tern"];
const KEY = "synccraft.identity";

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export const suggestName = () => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function createIdentity(name: string): Identity {
  const identity: Identity = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40) || suggestName(),
    color: pick(COLORS),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* private mode: identity just won't persist */
  }
  return identity;
}
