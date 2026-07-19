# Builds a fully static tmux (musl libc, static libevent + ncurses) so the connector can ship one
# binary that runs on any Linux with no shared-library dependency — dropping "needs tmux" from the
# client prerequisites entirely (install.sh drops it at ~/.config/microteams/bin/tmux, where
# cli/internal/terminal/tmux.go looks for it).
#
# The output is a single `/tmux` inside the export stage; build-static-tmux.sh extracts it. Pinned
# versions keep the build reproducible.
ARG ALPINE_VERSION=3.20
FROM alpine:${ALPINE_VERSION} AS build

ARG TMUX_VERSION=3.5a

# build-base = gcc/make/musl-dev; the *-static packages provide the .a archives that let us link
# libevent and ncurses into the binary instead of at runtime.
RUN apk add --no-cache \
        build-base \
        bison \
        curl \
        libevent-dev libevent-static \
        ncurses-dev ncurses-static \
        musl-dev

WORKDIR /src
RUN curl -fsSL -o tmux.tar.gz \
      "https://github.com/tmux/tmux/releases/download/${TMUX_VERSION}/tmux-${TMUX_VERSION}.tar.gz" \
 && tar xzf tmux.tar.gz \
 && cd "tmux-${TMUX_VERSION}" \
 # --enable-static asks tmux to link its deps statically; -static forces a fully static executable;
 # -no-pie avoids a dynamic interpreter being requested.
 && ./configure --enable-static CFLAGS="-static" LDFLAGS="-static -no-pie" \
 && make -j"$(nproc)" \
 && cp tmux /tmux \
 && strip /tmux

# Scratch stage so `docker build --output type=local` exposes just the binary.
FROM scratch AS export
COPY --from=build /tmux /tmux
