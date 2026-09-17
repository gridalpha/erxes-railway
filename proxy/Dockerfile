# The single public origin in front of an erxes deployment on Railway.
#
# The Caddyfile lives in the repo rather than in a service variable: a template
# replaces kilobyte-scale variable values with placeholder text, which would reach
# the container as a literal string and crash-loop the proxy.
FROM caddy:2-alpine

COPY proxy/Caddyfile /etc/caddy/Caddyfile

# Fail the build, not the boot, on a bad route. Every {$VAR} carries a default so
# validation works with nothing set.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
