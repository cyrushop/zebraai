# Serves the single-file PC Price Check page (built by tools/build_pc_check.py) on Cloud Run.
FROM nginx:1.27-alpine
COPY default.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
