#!/bin/bash
# Detailed build and push script for all images

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Registry URL
REGISTRY="localhost:32000"

echo -e "${YELLOW}Starting build and push process...${NC}"

# Function to build and push image
build_and_push() {
    local dir=$1
    local image_name=$2
    local tag=${3:-latest}
    
    echo -e "\n${YELLOW}Building $image_name...${NC}"
    
    if [ ! -d "$dir" ]; then
        echo -e "${RED}Error: Directory $dir not found!${NC}"
        return 1
    fi
    
    cd "$dir"
    
    # Build image
    if docker build -t "$REGISTRY/$image_name:$tag" .; then
        echo -e "${GREEN}✓ Successfully built $image_name${NC}"
    else
        echo -e "${RED}✗ Failed to build $image_name${NC}"
        return 1
    fi
    
    # Push image
    echo -e "${YELLOW}Pushing $image_name to registry...${NC}"
    if docker push "$REGISTRY/$image_name:$tag"; then
        echo -e "${GREEN}✓ Successfully pushed $image_name${NC}"
    else
        echo -e "${RED}✗ Failed to push $image_name${NC}"
        return 1
    fi
    
    cd - > /dev/null
}

# Start from project root
PROJECT_ROOT=$(pwd)

# 1. Build Chat Backend
echo -e "\n${YELLOW}=== CHAT BACKEND ===${NC}"
build_and_push "chat-app/chat-backend" "chat-backend"

# 2. Build Chat Frontend
echo -e "\n${YELLOW}=== CHAT FRONTEND ===${NC}"
build_and_push "chat-app/chat-frontend" "chat-frontend"

# 3. Build AI Backend
echo -e "\n${YELLOW}=== AI BACKEND ===${NC}"
build_and_push "ai-app/ai-backend" "ai-backend"

# 4. Build AI Frontend
echo -e "\n${YELLOW}=== AI FRONTEND ===${NC}"
build_and_push "ai-app/ai-frontend" "ai-frontend"

# Verify all images in registry
echo -e "\n${YELLOW}Verifying images in registry...${NC}"
CATALOG=$(curl -s http://localhost:32000/v2/_catalog)
echo -e "${GREEN}Registry contains: $CATALOG${NC}"

# List all images with tags
echo -e "\n${YELLOW}Image details:${NC}"
for repo in chat-backend chat-frontend ai-backend ai-frontend; do
    TAGS=$(curl -s http://localhost:32000/v2/$repo/tags/list 2>/dev/null || echo "Not found")
    echo "$repo: $TAGS"
done

echo -e "\n${GREEN}Build and push process completed!${NC}"