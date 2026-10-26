#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <dispatch/dispatch.h>
#include <stdlib.h>
#include <string.h>

// Objective-C bridge for macOS built-in speech recognition (SFSpeechRecognizer).
// All exported functions are called from Rust on a blocking thread, never on the
// main thread (requestAuthorization would otherwise block the UI run loop).

static void set_error_code(int32_t *out_error_code, int32_t code) {
    if (out_error_code != NULL) {
        *out_error_code = code;
    }
}

int32_t typek_apple_speech_auth_status(void) {
    return (int32_t)[SFSpeechRecognizer authorizationStatus];
}

int32_t typek_apple_speech_request_auth(int32_t timeout_secs) {
    SFSpeechRecognizerAuthorizationStatus status = [SFSpeechRecognizer authorizationStatus];
    if (status != SFSpeechRecognizerAuthorizationStatusNotDetermined) {
        return (int32_t)status;
    }

    __block SFSpeechRecognizerAuthorizationStatus final_status =
        SFSpeechRecognizerAuthorizationStatusNotDetermined;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus new_status) {
        final_status = new_status;
        dispatch_semaphore_signal(semaphore);
    }];

    int64_t wait_secs = timeout_secs > 0 ? (int64_t)timeout_secs : 60;
    dispatch_time_t timeout =
        dispatch_time(DISPATCH_TIME_NOW, wait_secs * NSEC_PER_SEC);
    dispatch_semaphore_wait(semaphore, timeout);

    return (int32_t)final_status;
}

char *typek_apple_speech_transcribe(const char *wav_path,
                                    const char *locale_id,
                                    const char *contextual_terms,
                                    int32_t audio_ms,
                                    int32_t timeout_secs,
                                    int32_t *out_error_code) {
    set_error_code(out_error_code, 0);

    if ([SFSpeechRecognizer authorizationStatus] !=
        SFSpeechRecognizerAuthorizationStatusAuthorized) {
        set_error_code(out_error_code, 1); // NOT_AUTHORIZED
        return NULL;
    }

    if (wav_path == NULL || locale_id == NULL) {
        set_error_code(out_error_code, 3); // RECOGNITION_FAILED
        return NULL;
    }

    NSString *path_string = [NSString stringWithUTF8String:wav_path];
    NSString *locale_string = [NSString stringWithUTF8String:locale_id];
    if (path_string == nil || locale_string == nil) {
        set_error_code(out_error_code, 3); // RECOGNITION_FAILED
        return NULL;
    }

    NSURL *file_url = [NSURL fileURLWithPath:path_string isDirectory:NO];
    if (file_url == nil) {
        set_error_code(out_error_code, 3); // RECOGNITION_FAILED
        return NULL;
    }

    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:locale_string];
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    if (recognizer == nil || ![recognizer isAvailable]) {
        set_error_code(out_error_code, 2); // LOCALE_UNSUPPORTED
        return NULL;
    }

    // 部署目標是 10.15，這兩個屬性一定存在；不用 @available，
    // 否則會產生 ___isPlatformVersionAtLeast 參照，Rust 連結時找不到。
    BOOL uses_on_device = recognizer.supportsOnDeviceRecognition;

    if (!uses_on_device && audio_ms > 55000) {
        // Apple 線上辨識單次約 1 分鐘上限；超過就要求先下載聽寫語言包。
        set_error_code(out_error_code, 5); // NEEDS_LANGUAGE_PACK
        return NULL;
    }

    SFSpeechURLRecognitionRequest *request =
        [[SFSpeechURLRecognitionRequest alloc] initWithURL:file_url];
    request.shouldReportPartialResults = NO;
    request.requiresOnDeviceRecognition = uses_on_device;
    // addsPunctuation 是 macOS 13+；用 respondsToSelector + KVC 判斷，理由同上
    if ([request respondsToSelector:@selector(setAddsPunctuation:)]) {
        [request setValue:@YES forKey:@"addsPunctuation"];
    }

    if (contextual_terms != NULL) {
        NSString *terms_string = [NSString stringWithUTF8String:contextual_terms];
        if (terms_string != nil) {
            NSMutableArray<NSString *> *term_list = [NSMutableArray array];
            for (NSString *term in [terms_string componentsSeparatedByString:@"\n"]) {
                NSString *trimmed =
                    [term stringByTrimmingCharactersInSet:
                             [NSCharacterSet whitespaceAndNewlineCharacterSet]];
                if (trimmed.length > 0) {
                    [term_list addObject:trimmed];
                }
            }
            if (term_list.count > 0) {
                request.contextualStrings = term_list;
            }
        }
    }

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block NSString *transcript = nil;
    __block BOOL failed = NO;

    SFSpeechRecognitionTask *task =
        [recognizer recognitionTaskWithRequest:request
                                 resultHandler:^(SFSpeechRecognitionResult *result,
                                                 NSError *error) {
        if (error != nil) {
            failed = YES;
            dispatch_semaphore_signal(semaphore);
            return;
        }
        if (result != nil && result.isFinal) {
            transcript = result.bestTranscription.formattedString;
            dispatch_semaphore_signal(semaphore);
        }
    }];

    if (task == nil) {
        set_error_code(out_error_code, 3); // RECOGNITION_FAILED
        return NULL;
    }

    int64_t wait_secs = timeout_secs > 0 ? (int64_t)timeout_secs : 30;
    dispatch_time_t timeout =
        dispatch_time(DISPATCH_TIME_NOW, wait_secs * NSEC_PER_SEC);
    long wait_result = dispatch_semaphore_wait(semaphore, timeout);

    if (wait_result != 0) {
        [task cancel];
        set_error_code(out_error_code, 4); // TIMEOUT
        return NULL;
    }

    if (failed) {
        set_error_code(out_error_code, 3); // RECOGNITION_FAILED
        return NULL;
    }

    if (transcript == nil) {
        transcript = @"";
    }

    const char *utf8_text = [transcript UTF8String];
    if (utf8_text == NULL) {
        set_error_code(out_error_code, 3); // RECOGNITION_FAILED
        return NULL;
    }
    return strdup(utf8_text);
}

int32_t typek_apple_speech_locale_available(const char *locale_id) {
    if (locale_id == NULL) {
        return 0;
    }
    NSString *locale_string = [NSString stringWithUTF8String:locale_id];
    if (locale_string == nil) {
        return 0;
    }
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:locale_string];
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    if (recognizer == nil || ![recognizer isAvailable]) {
        return 0;
    }
    return 1;
}

void typek_apple_speech_free(char *ptr) {
    free(ptr);
}
