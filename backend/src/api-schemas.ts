import * as t from 'io-ts';

// Base response schemas
export const ApiErrorResponseCodec = t.type({
  error: t.string,
  message: t.string
});

export const ApiStatusResponseCodec = t.partial({
  status: t.string,
  message: t.string,
  timestamp: t.string,
  uptime: t.number
});

// Video list response
export const VideoItemCodec = t.type({
  id: t.string,
  title: t.string,
  hlsUrl: t.string,
  status: t.union([
    t.literal('converting'),
    t.literal('ready'),
    t.literal('failed')
  ]),
  thumbnailUrl: t.union([t.string, t.null])
});

export const VideoListResponseCodec = t.type({
  videos: t.array(VideoItemCodec),
  count: t.number
});

// Video info response
export const VideoInfoResponseCodec = t.type({
  id: t.string,
  title: t.string,
  hlsUrl: t.string,
  status: t.union([
    t.literal('converting'),
    t.literal('ready'),
    t.literal('failed')
  ]),
  thumbnailUrl: t.union([t.string, t.null])
});

// Upload response
export const UploadResponseCodec = t.type({
  message: t.string,
  videoId: t.string,
  title: t.string,
  status: t.literal('converting')
});

// Conversion status response
export const ConversionStatusCodec = t.intersection([
  t.type({
    videoId: t.string,
    sourcePath: t.string,
    targetPath: t.string,
    status: t.union([
      t.literal('pending'),
      t.literal('converting'),
      t.literal('completed'),
      t.literal('failed')
    ])
  }),
  t.partial({
    error: t.string
  })
]);

export const AllConversionStatusResponseCodec = t.type({
  jobs: t.array(ConversionStatusCodec)
});

// Update video response
export const UpdateVideoResponseCodec = t.type({
  message: t.string
});

// Delete video response
export const DeleteVideoResponseCodec = t.type({
  message: t.string
});

// Extract static types
export type ApiErrorResponse = t.TypeOf<typeof ApiErrorResponseCodec>;
export type ApiStatusResponse = t.TypeOf<typeof ApiStatusResponseCodec>;
export type VideoItem = t.TypeOf<typeof VideoItemCodec>;
export type VideoListResponse = t.TypeOf<typeof VideoListResponseCodec>;
export type VideoInfoResponse = t.TypeOf<typeof VideoInfoResponseCodec>;
export type UploadResponse = t.TypeOf<typeof UploadResponseCodec>;
export type ConversionStatus = t.TypeOf<typeof ConversionStatusCodec>;
export type AllConversionStatusResponse = t.TypeOf<typeof AllConversionStatusResponseCodec>;
export type UpdateVideoResponse = t.TypeOf<typeof UpdateVideoResponseCodec>;
export type DeleteVideoResponse = t.TypeOf<typeof DeleteVideoResponseCodec>;