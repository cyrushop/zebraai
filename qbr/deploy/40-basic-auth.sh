#!/bin/sh
# Turns on HTTP Basic Auth when BASIC_AUTH_USER and BASIC_AUTH_PASS are set
# (e.g. from Secret Manager on Cloud Run). Without them the site is open.
set -eu
CONF=/tmp/nginx-auth.conf
if [ -n "${BASIC_AUTH_USER:-}" ] && [ -n "${BASIC_AUTH_PASS:-}" ]; then
  case "$BASIC_AUTH_USER$BASIC_AUTH_PASS" in
    *:*) echo "basic-auth: BASIC_AUTH_USER / BASIC_AUTH_PASS must not contain ':'" >&2; exit 1 ;;
  esac
  umask 077
  printf '%s:{PLAIN}%s\n' "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS" > /tmp/htpasswd
  printf 'auth_basic "Zebra HK QBR";\nauth_basic_user_file /tmp/htpasswd;\n' > "$CONF"
  echo "basic-auth: enabled for user $BASIC_AUTH_USER"
else
  echo 'auth_basic off;' > "$CONF"
  echo "basic-auth: disabled (BASIC_AUTH_USER / BASIC_AUTH_PASS not set)"
fi
