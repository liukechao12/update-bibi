# Browserless + 中文字体
# 官方镜像不带 CJK 字体，中文页面会渲染成方块，这里补装。
FROM ghcr.io/browserless/chromium:latest

USER root
# 服务器直连 deb.debian.org 不通，换阿里云源；bookworm 用 DEB822 格式，旧版用 sources.list
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

USER 1000
