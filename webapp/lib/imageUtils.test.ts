import {
    PROCESSED_IMAGES_PATH,
    RAW_UPLOADS_PATH,
    THUMBNAIL_WIDTH,
    MEDIUM_WIDTH,
} from './constants/imageConstants';
import { getProcessedImagePath, getPublicImageUrl } from './imageUtils';

describe('imageUtils', () => {
    const supabaseUrl = 'https://xyz.supabase.co';
    const bucketName = 'public-images'; // Example public bucket name

    describe('getProcessedImagePath', () => {
        it('should generate correct path for simple filenames', () => {
            const originalPath = 'user123/avatar.png';
            const expected = `user123/avatar_${THUMBNAIL_WIDTH}.webp`;
            expect(getProcessedImagePath(originalPath, THUMBNAIL_WIDTH)).toBe(expected);
        });

        it('should generate correct path for filenames with dots', () => {
            const originalPath = 'project-abc/version-1.0/screenshot.main.jpg';
            const expected = `project-abc/version-1.0/screenshot.main_${MEDIUM_WIDTH}.webp`;
            expect(getProcessedImagePath(originalPath, MEDIUM_WIDTH)).toBe(expected);
        });

        it('should handle paths without directories', () => {
            const originalPath = 'logo.gif';
            const expected = `logo_${THUMBNAIL_WIDTH}.webp`;
            expect(getProcessedImagePath(originalPath, THUMBNAIL_WIDTH)).toBe(expected);
        });

         it('should handle paths starting with the raw upload path constant', () => {
            const originalPath = `${RAW_UPLOADS_PATH}/more/images/test.jpeg`;
            const expected = `${RAW_UPLOADS_PATH}/more/images/test_${MEDIUM_WIDTH}.webp`;
            expect(getProcessedImagePath(originalPath, MEDIUM_WIDTH)).toBe(expected);
        });
    });

    describe('getPublicImageUrl', () => {
        it('should construct the correct public URL', () => {
            const processedPath = `user123/avatar_${THUMBNAIL_WIDTH}.webp`;
            const expected = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${processedPath}`;
            expect(getPublicImageUrl(supabaseUrl, bucketName, processedPath)).toBe(expected);
        });

        it('should handle supabaseUrl with or without trailing slash', () => {
            const processedPath = `user123/avatar_${MEDIUM_WIDTH}.webp`;
            const expected = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${processedPath}`;

            expect(getPublicImageUrl(supabaseUrl + '/', bucketName, processedPath)).toBe(expected);
            expect(getPublicImageUrl(supabaseUrl, bucketName, processedPath)).toBe(expected);
        });
    });
}); 