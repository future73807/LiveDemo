/** 昵称 → 稳定颜色（聊天昵称/头像用，同一昵称颜色恒定） */
const PALETTE = ['#23ade5', '#fb7299', '#3ecf8e', '#ffb027', '#7b6cf6', '#ff8f5c', '#2dd4bf', '#f472b6'];

export function nickColor(nick: string): string {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 头像内展示的首字符（中文取首字，英文取首字母大写） */
export function nickInitial(nick: string): string {
  const c = nick.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}
