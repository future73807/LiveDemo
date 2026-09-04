export interface Room {
  id: number;
  title: string;
  ownerId: string;
  ownerName: string;
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

export interface PlayUrls { webrtc: string; flv: string; hls: string; }

/** 网页直接开播（WHIP），无推流码/推流服务器概念 */
export interface PublishUrls { whip: string; }

export interface AuthUser { userId: string; nickname: string; roles: string[]; }

export interface ChatMessage {
  messageId: string;
  userId: string;
  nickname: string;
  content: string;
  ts: number;
}
