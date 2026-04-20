#include <string.h>
#include <jni.h>

extern "C" {

JNIEXPORT void JNICALL Java_com_monitor_TelegramService_processCommandNative(JNIEnv* env, jobject thiz, jstring jMessage) {
    // Return if message is null
    if (jMessage == NULL) return;

    // Get UTF-8 chars
    const char* message = env->GetStringUTFChars(jMessage, NULL);
    if (message == NULL) return; // Out of memory?

    // Check for "/play " command
    const char* command = "/play ";
    size_t cmdLen = strlen(command);
    if (strncmp(message, command, cmdLen) == 0) {
        const char* videoUrl = message + cmdLen;

        // Get Java class and method
        jclass serviceClass = env->GetObjectClass(thiz);
        if (serviceClass != NULL) {
            jmethodID playMethodId = env->GetMethodID(serviceClass, "playVideo", "(Ljava/lang/String;)V");
            if (playMethodId != NULL) {
                jstring jUrl = env->NewStringUTF(videoUrl);
                if (jUrl != NULL) {
                    env->CallVoidMethod(thiz, playMethodId, jUrl);
                    env->DeleteLocalRef(jUrl);
                }
            }
            env->DeleteLocalRef(serviceClass);
        }
    }

    // Release UTF-8 chars (very important)
    env->ReleaseStringUTFChars(jMessage, message);
}

} // extern "C"
