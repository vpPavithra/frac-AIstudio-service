#!/bin/bash
# Builds the runtime Docker image and writes metadata.json for Jenkins to archive.
# Called by the Jenkinsfile "Build" stage: build.sh <build_tag> <node_name> <hub_org>.
# Needs dist/, config/ and migrations/ in the working directory (from the pre-build dist.zip).
# Tags the image <hub_org>/frac-studio-service:<build_tag>, labelled with the commit hash.
set -eo pipefail

build_tag=$1
name='frac-studio-service'
node=$2
org=$3

docker build -f Dockerfile --label commitHash=$(git rev-parse --short HEAD) -t ${org}/${name}:${build_tag} .
echo {\"image_name\" : \"${name}\", \"image_tag\" : \"${build_tag}\", \"node_name\" : \"$node\"} > metadata.json
