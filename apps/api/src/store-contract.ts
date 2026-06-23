import type {
  ApiEvent,
  CreatePredictionInput,
  PredictionCommentInput,
  PrizeDeskEntry,
  ReplyInput,
  Room,
  ThemeOption,
  ToggleLikeInput,
  UpdatePredictionInput,
  UpdateReplyInput,
} from '@turntabl-score-room/shared'

type MaybePromise<T> = T | Promise<T>

export type WebSocketLike = {
  send: (data: string) => void
  readyState?: number
}

export type RoomStore = {
  getRooms(): MaybePromise<Room[]>
  getRoom(roomRef: string): MaybePromise<Room | null>
  getThemes(): ThemeOption[]
  registerClient(clientId: string, ws: WebSocketLike): void
  unregisterClient(clientId: string): void
  broadcast(event: ApiEvent): void
  addPrediction(roomRef: string, payload: CreatePredictionInput): MaybePromise<Room | null>
  setPredictionLike(predictionId: string, userId: string, liked: ToggleLikeInput['liked']): MaybePromise<Room | null>
  updatePredictionText(predictionId: string, payload: UpdatePredictionInput): MaybePromise<Room | null>
  addPredictionComment(predictionId: string, payload: PredictionCommentInput): MaybePromise<Room | null>
  getPrizeDeskEntries(): MaybePromise<PrizeDeskEntry[]>
  addReply(commentId: string, payload: ReplyInput): MaybePromise<Room | null>
  updateReply(replyId: string, payload: UpdateReplyInput): MaybePromise<Room | null>
}
