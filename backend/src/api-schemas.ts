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
  }),
]);
export type VideoInfoResponse = t.TypeOf<typeof VideoInfoResponseCodec>;

// Upload response
export const UploadResponseCodec = t.type({
  message: t.string,
  videoId: t.string,
  title: t.string,
  status: t.literal('converting')
});
export type UploadResponse = t.TypeOf<typeof UploadResponseCodec>;

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
