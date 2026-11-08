FROM archlinux:base
RUN pacman -Syu --noconfirm --needed gnome-online-accounts gnome-keyring libsecret dbus python python-gobject \
    && pacman -Scc --noconfirm \
    && install -d -m 0700 -o 65534 -g 65534 /goa /goa/config /goa/data
COPY docker/self-host/goa-mail.py docker/self-host/goa-grants.py /opt/
ENV HOME=/goa XDG_CONFIG_HOME=/goa/config XDG_DATA_HOME=/goa/data XDG_RUNTIME_DIR=/run/zero-goa XDG_CACHE_HOME=/run/zero-goa/cache
USER 65534:65534
CMD ["dbus-run-session", "--", "python", "/opt/goa-mail.py"]
