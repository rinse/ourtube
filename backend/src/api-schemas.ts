import * as t from 'io-ts';

export const ApiErrorResponseCodec = t.type({
  error: t.string,
  message: t.string
});
export type ApiErrorResponse = t.TypeOf<typeof ApiErrorResponseCodec>;

export const ApiStatusResponseCodec = t.partial({
  status: t.string,
  message: t.string,
  timestamp: t.string,
  uptime: t.number
});
export type ApiStatusResponse = t.TypeOf<typeof ApiStatusResponseCodec>;

// Video list response
export const VideoItemCodec = t.intersection([
  t.type({
    id: t.string,
    title: t.string,
    hlsUrl: t.string,
    status: t.union([
      t.literal('converting'),
      t.literal('ready'),
      t.literal('failed')
    ]),
  }),
  t.partial({
    thumbnailUrl: t.string,
    created_at: t.string,
    duration: t.number,
  }),
]);
export type VideoItem = t.TypeOf<typeof VideoItemCodec>;

export const VideoListResponseCodec = t.type({
  videos: t.array(VideoItemCodec),
  count: t.number
});
export type VideoListResponse = t.TypeOf<typeof VideoListResponseCodec>;

// Video info response
export const VideoInfoResponseCodec = t.intersection([
  t.type({
    id: t.string,
    title: t.string,
    hlsUrl: t.string,
    status: t.union([
      t.literal('converting'),
      t.literal('ready'),
      t.literal('failed')
    ]),
  }),
  t.partial({
    thumbnailUrl: t.string,
    created_at: t.string,
    duration: t.number,
  }),
]);
export type VideoInfoResponse = t.TypeOf<typeof VideoInfoResponseCodec>;

// Create-upload response (presigned PUT handshake)
export const CreateUploadResponseCodec = t.type({
  videoId: t.string,
  title: t.string,
  status: t.literal('converting'),
  uploadUrl: t.string,
  key: t.string,
});
export type CreateUploadResponse = t.TypeOf<typeof CreateUploadResponseCodec>;

// Generic ok response
export const OkResponseCodec = t.type({
  message: t.string,
});
export type OkResponse = t.TypeOf<typeof OkResponseCodec>;

// Update video response
export const UpdateVideoResponseCodec = t.type({
  message: t.string
});
export type UpdateVideoResponse = t.TypeOf<typeof UpdateVideoResponseCodec>;

// Delete video response
export const DeleteVideoResponseCodec = t.type({
  message: t.string
});
export type DeleteVideoResponse = t.TypeOf<typeof DeleteVideoResponseCodec>;

export const SuggestVideoTitleResponseCodec = t.type({
  suggestedTitle: t.string,
});
export type SuggestVideoTitleResponse = t.TypeOf<typeof SuggestVideoTitleResponseCodec>;

// --- Playlists --------------------------------------------------------------

// Lightweight playlist view for the list endpoint (no resolved videos).
export const PlaylistSummaryCodec = t.type({
  id: t.string,
  name: t.string,
  videoCount: t.number,
  created_at: t.string,
  updated_at: t.string,
});
export type PlaylistSummary = t.TypeOf<typeof PlaylistSummaryCodec>;

export const PlaylistListResponseCodec = t.type({
  playlists: t.array(PlaylistSummaryCodec),
  count: t.number,
});
export type PlaylistListResponse = t.TypeOf<typeof PlaylistListResponseCodec>;

// Full playlist with its videos resolved in order (missing/deleted skipped).
export const PlaylistDetailResponseCodec = t.type({
  id: t.string,
  name: t.string,
  created_at: t.string,
  updated_at: t.string,
  videos: t.array(VideoItemCodec),
});
export type PlaylistDetailResponse = t.TypeOf<typeof PlaylistDetailResponseCodec>;
