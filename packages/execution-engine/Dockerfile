FROM alpine:latest

# Install g++ and necessary build tools
RUN apk add --no-cache build-base

# Create directory for standard bits header
RUN mkdir -p /usr/include/bits/

# Copy the standard header file (create a dummy one here if it doesn't exist to allow the precompilation step to work)
# A typical competitive programming bits/stdc++.h includes a ton of libraries
RUN echo '#include <iostream>' > /usr/include/bits/stdc++.h && \
    echo '#include <vector>' >> /usr/include/bits/stdc++.h && \
    echo '#include <string>' >> /usr/include/bits/stdc++.h && \
    echo '#include <algorithm>' >> /usr/include/bits/stdc++.h && \
    echo '#include <map>' >> /usr/include/bits/stdc++.h && \
    echo '#include <set>' >> /usr/include/bits/stdc++.h && \
    echo '#include <unordered_map>' >> /usr/include/bits/stdc++.h && \
    echo '#include <unordered_set>' >> /usr/include/bits/stdc++.h && \
    echo '#include <queue>' >> /usr/include/bits/stdc++.h && \
    echo '#include <stack>' >> /usr/include/bits/stdc++.h && \
    echo '#include <cmath>' >> /usr/include/bits/stdc++.h && \
    echo '#include <numeric>' >> /usr/include/bits/stdc++.h

# PRECOMPILE the header (creates stdc++.h.gch)
RUN g++ -O3 -x c++-header -c /usr/include/bits/stdc++.h \
    -o /usr/include/bits/stdc++.h.gch

# Setup execution user to prevent root escalation
RUN adduser -D runner
WORKDIR /app
RUN chown runner:runner /app

# Keep container alive infinitely for warm pooling
CMD ["tail", "-f", "/dev/null"]
