import Foundation
import Capacitor
import Photos
import UIKit
import CoreLocation

/// Custom bridge view controller whose only job is to register the app-local
/// `PhotosPlugin` with the Capacitor bridge once it has loaded. The storyboard
/// points at this class instead of the stock `CAPBridgeViewController`.
@objc(MainViewController)
public class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhotosPlugin())
    }
}

/// On-device replacement for the Mac server's Apple Photos access. Exposes the
/// three things the web app needs: permission status, a flat list of geotagged
/// photo metadata, and a JPEG thumbnail for a given asset.
@objc(PhotosPlugin)
public class PhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotosPlugin"
    public let jsName = "Photos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryAssets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getThumbnail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reverseGeocode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveVideo", returnType: CAPPluginReturnPromise),
    ]

    private let imageManager = PHCachingImageManager()
    private let geocoder = CLGeocoder()

    // MARK: - Permission

    @objc func requestAccess(_ call: CAPPluginCall) {
        // iOS has no "read-only" access level (only .readWrite or .addOnly), so
        // reading photos requires .readWrite. This plugin nonetheless only ever
        // READS: it has no call that adds, edits, deletes, or favorites assets.
        // The user can also grant "Limited" access to hand-pick which photos
        // are even visible to the app.
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            call.resolve(["status": PhotosPlugin.statusString(status)])
        }
    }

    private static func statusString(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    // MARK: - Query geotagged assets

    @objc func queryAssets(_ call: CAPPluginCall) {
        let yearsBack = call.getInt("yearsBack") ?? 5

        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            call.reject("Photo library access not granted")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let cutoff = Calendar.current.date(
                byAdding: .year, value: -yearsBack, to: Date()
            ) ?? Date(timeIntervalSince1970: 0)

            let options = PHFetchOptions()
            options.predicate = NSPredicate(
                format: "mediaType == %d AND creationDate > %@",
                PHAssetMediaType.image.rawValue, cutoff as NSDate
            )
            options.sortDescriptors = [
                NSSortDescriptor(key: "creationDate", ascending: true)
            ]

            let result = PHAsset.fetchAssets(with: options)
            var assets: [[String: Any]] = []
            assets.reserveCapacity(result.count)

            result.enumerateObjects { asset, _, _ in
                guard let loc = asset.location else { return }
                let lat = loc.coordinate.latitude
                let lng = loc.coordinate.longitude
                // Skip invalid / "no location" sentinels.
                if !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) { return }
                if lat == 0 && lng == 0 { return }

                let isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)
                assets.append([
                    "id": asset.localIdentifier,
                    "lat": lat,
                    "lng": lng,
                    "dateTaken": (asset.creationDate ?? Date()).timeIntervalSince1970 * 1000,
                    "isFavorite": asset.isFavorite,
                    "width": asset.pixelWidth,
                    "height": asset.pixelHeight,
                    "burstId": asset.burstIdentifier ?? "",
                    "isScreenshot": isScreenshot,
                ])
            }

            call.resolve(["assets": assets])
        }
    }

    // MARK: - Thumbnail

    @objc func getThumbnail(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing asset id")
            return
        }
        let width = CGFloat(call.getInt("width") ?? 400)

        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
        guard let asset = fetch.firstObject else {
            call.reject("Asset not found")
            return
        }

        let aspect = asset.pixelHeight > 0
            ? CGFloat(asset.pixelHeight) / CGFloat(asset.pixelWidth)
            : 1
        let target = CGSize(width: width, height: max(1, width * aspect))

        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isSynchronous = false

        var didResolve = false
        imageManager.requestImage(
            for: asset,
            targetSize: target,
            contentMode: .aspectFill,
            options: options
        ) { image, info in
            // The handler can fire twice (a fast low-res pass then the final
            // image). Only resolve once, on a real (non-degraded) image.
            if didResolve { return }
            let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
            guard let image = image, !isDegraded else { return }
            didResolve = true

            guard let data = image.jpegData(compressionQuality: 0.8) else {
                call.reject("Could not encode thumbnail")
                return
            }
            let dataUrl = "data:image/jpeg;base64," + data.base64EncodedString()
            call.resolve(["dataUrl": dataUrl])
        }
    }

    // MARK: - Save a video to the Photos library

    /// Saves a base64-encoded video (e.g. the exported travel reel) into the
    /// user's camera roll. The web layer can't write files in WKWebView, so the
    /// "Save" button hands the bytes here. We already hold .readWrite
    /// authorization (from requestAccess), which covers adding new assets.
    @objc func saveVideo(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data"), !base64.isEmpty else {
            call.reject("Missing video data")
            return
        }
        guard let data = Data(base64Encoded: base64) else {
            call.reject("Invalid video data")
            return
        }
        let ext = call.getString("ext") ?? "mp4"

        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            call.reject("Photo library access not granted")
            return
        }

        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("travel-reel-\(UUID().uuidString).\(ext)")
        do {
            try data.write(to: tmpURL, options: .atomic)
        } catch {
            call.reject("Could not write video: \(error.localizedDescription)")
            return
        }

        PHPhotoLibrary.shared().performChanges({
            PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: tmpURL)
        }) { success, error in
            try? FileManager.default.removeItem(at: tmpURL)
            if success {
                call.resolve(["saved": true])
            } else {
                call.reject(error?.localizedDescription ?? "Could not save video")
            }
        }
    }

    // MARK: - Reverse geocode (place names)

    @objc func reverseGeocode(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else {
            call.reject("Missing lat/lng")
            return
        }
        let location = CLLocation(latitude: lat, longitude: lng)
        geocoder.reverseGeocodeLocation(location) { placemarks, error in
            // Surface the error (CLGeocoder throttles bursts with a transient
            // failure) so the JS side can back off and retry instead of silently
            // falling back to a country-only label.
            if let error = error {
                call.reject(error.localizedDescription, nil, error)
                return
            }
            let p = placemarks?.first
            call.resolve([
                "locality": p?.locality ?? "",
                "subLocality": p?.subLocality ?? "",
                "subAdministrativeArea": p?.subAdministrativeArea ?? "",
                "administrativeArea": p?.administrativeArea ?? "",
                "countryCode": p?.isoCountryCode ?? "",
            ])
        }
    }
}
