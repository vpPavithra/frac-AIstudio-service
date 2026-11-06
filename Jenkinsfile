// Jenkins pipeline for frac-studio-service, run on demand with a github_release_tag parameter.
// Same pipeline shape as playlist-service: compile in a pre-build image, package the runtime
// image with build.sh, archive metadata, then a report-only SonarQube stage.
// Needs env hub_org (image registry/org) and docker_pre_build (pre-build image/container name).
// Produces the image ${hub_org}/frac-studio-service:<tag>_<commit>_<build>, metadata.json and build_tag.txt.
node('build-slave') {
    try {
        String ANSI_GREEN = "\u001B[32m"
        String ANSI_NORMAL = "\u001B[0m"
        String ANSI_BOLD = "\u001B[1m"
        String ANSI_RED = "\u001B[31m"

        ansiColor('xterm') {
            stage('Checkout') {
                if (!env.hub_org) {
                    println(ANSI_BOLD + ANSI_RED + "Please set a Jenkins environment variable named hub_org (the image registry/org)" + ANSI_NORMAL)
                    error 'Please resolve the errors and rerun..'
                } else
                    println(ANSI_BOLD + ANSI_GREEN + "Found environment variable named hub_org with value as: " + hub_org + ANSI_NORMAL)
            }

            cleanWs()
            checkout scm
            commit_hash = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
            build_tag = sh(script: "echo " + params.github_release_tag.split('/')[-1] + "_" + commit_hash + "_" + env.BUILD_NUMBER, returnStdout: true).trim()
            echo "build_tag: " + build_tag

            stage('docker-pre-build') {
                sh '''
                docker build -f ./Dockerfile.build -t $docker_pre_build .
                docker run --name=$docker_pre_build $docker_pre_build && docker cp $docker_pre_build:/usr/src/app/dist.zip .
                docker rm -f $docker_pre_build
                docker rmi -f $docker_pre_build
                unzip -o dist.zip
                '''
            }

            stage('Build') {
                env.NODE_ENV = "build"
                sh('chmod 777 build.sh')
                sh("bash -x build.sh ${build_tag} ${env.NODE_NAME} ${hub_org}")
            }

            stage('ArchiveArtifacts') {
                sh("echo ${build_tag} > build_tag.txt")
                archiveArtifacts "metadata.json"
                archiveArtifacts "build_tag.txt"
                currentBuild.description = "${build_tag}"
            }

            // Report-only for the first rollout; set abortPipeline: true after one clean run.
            // Jenkins must have a SonarQube server named 'SonarQube' and a scanner tool named
            // 'SonarScanner' (Manage Jenkins), and Node.js on this build node.
            stage('SonarQube Analysis') {
                sh '''
                  npm ci
                  npm run test:coverage
                '''
                def scannerHome = tool 'SonarScanner'
                withSonarQubeEnv('SonarQube') {
                    sh "${scannerHome}/bin/sonar-scanner"
                }
            }

            stage('Quality Gate') {
                timeout(time: 10, unit: 'MINUTES') {
                    def qg = waitForQualityGate abortPipeline: false
                    echo "SonarQube Quality Gate status: ${qg.status}"
                }
            }
        }
    }
    catch (err) {
        currentBuild.result = "FAILURE"
        throw err
    }
}
