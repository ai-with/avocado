# Linux/amd64 is required by Cloudflare Containers. The official Python manifest
# is digest-pinned; Debian/x264 package versions still resolve at build time.
FROM python:3.13.3-slim-bookworm@sha256:56a11364ffe0fee3bd60af6d6d5209eba8a99c2c16dc4c7c5861dc06261503cc AS build
ARG FFMPEG_VERSION=8.1.1
ARG FFMPEG_SHA256=b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils build-essential pkg-config nasm libx264-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl --fail --location --proto '=https' --max-time 120 \
      "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o ffmpeg.tar.xz \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xf ffmpeg.tar.xz --strip-components=1 \
    && ./configure --prefix=/opt/ffmpeg --disable-doc --disable-debug \
       --disable-ffplay --disable-network --disable-autodetect \
       --enable-gpl --enable-libx264 --enable-protocol=file,pipe \
    && make -j2 && make install

FROM python:3.13.3-slim-bookworm@sha256:56a11364ffe0fee3bd60af6d6d5209eba8a99c2c16dc4c7c5861dc06261503cc
RUN apt-get update && apt-get install -y --no-install-recommends libx264-164 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /work /usr/share/licenses/ffmpeg \
    && chown 65532:65532 /work
COPY --from=build /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=build /opt/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=build /build/COPYING.GPLv2 /usr/share/licenses/ffmpeg/COPYING.GPLv2
COPY runner.py protocol.py /app/
ENV TMPDIR=/work PYTHONDONTWRITEBYTECODE=1
USER 65532:65532
WORKDIR /work
# Idle PID1; the private supervisor starts fixed Python jobs through exec().
# Pinned local workerd maps start.entrypoint to Docker Cmd, so a Python image
# ENTRYPOINT would incorrectly receive "sleep infinity" as runner arguments.
# No HTTP listener/debug route. Clear inherited ENTRYPOINT explicitly.
ENTRYPOINT []
CMD ["sleep", "infinity"]
