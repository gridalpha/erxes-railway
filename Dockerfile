# erxes core-api for Railway.
#
# Upstream's published image is used as-is; the only addition is an entrypoint
# that seeds the first owner account, because erxes leaves `usersCreateOwner`
# open to anonymous callers until the `users` collection is non-empty.
FROM erxes/erxes-next-core-api:latest

# The base image ends on USER 1000, which RUN and COPY would otherwise inherit.
USER root

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY seed-owner.mjs /app/seed-owner.mjs

RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh /app/seed-owner.mjs \
    # Fail the build, not a crash loop, on a typo in either committed script.
    && sh -n /usr/local/bin/docker-entrypoint.sh \
    && node --check /app/seed-owner.mjs \
    # seed-owner.mjs imports the driver directly; assert it is really hoisted.
    && node -e "require.resolve('mongodb')"

USER 1000

CMD ["/usr/local/bin/docker-entrypoint.sh"]
