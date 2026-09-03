export interface Room {
  id: number;
  title: string;
  ownerId: string;
  ownerName: string;
  streamKey: string | null;
  pushUrl: string | null;
  status: 'IDLE' | 'LIVING';
  viewerCount: number;
  productCount: number;
  createdAt: string;
}

export interface Product {
  id: number;
  title: string;
  price: number;
  imageUrl: string | null;
  detailUrl: string | null;
}

export interface CartEntry {
  itemId: number;
  productId: number;
  title: string;
  price: number;
  imageUrl: string | null;
  qty: number;
}

export interface PlayUrls { webrtc: string; flv: string; hls: string; }

export interface ChatMessage {
  messageId: string;
  userId: string;
  nickname: string;
  content: string;
  ts: number;
}
