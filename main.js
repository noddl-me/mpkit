const sys = uni.getSystemInfoSync();
const getSDKVersion = (str) => {
  const arr = str.split(".");
  const s = arr.join("");
  return parseInt(s, 10);
};
const platform = sys.platform;
class Mpking {
  globalData = {
    verification: false,
    config: null,
    openid: null,
    user: null,
    announcement: null,
    cc: {},
  };

  version = "1.0.0";
  isDev = true;
  application = "";
  baseUrl = "";
  ossUrl = "";
  ossKey = "kokodayo";
  platform = platform;
  runtime = "wechat";
  isWeapp = typeof wx !== "undefined";
  sdkVersion = getSDKVersion(sys.SDKVersion);
  logger = null;

  timelineEnabled =
    this.isWeapp &&
    this.sdkVersion >= 2113 &&
    (platform === "android" || platform === "devtools");

  init(options) {
    this.version = options.version || "1.0.0";
    if (process.env.NODE_ENV === "production") {
      this.isDev = false;
    } else {
      this.isDev = options.isDev;
    }
    this.runtime = options.runtime || "wechat";
    this.application = options.application || "";
    this.baseUrl = options.baseUrl || "https://www.noddl.me/v3";
    this.ossUrl = options.ossUrl || "https://bbq.noddl.me";
    if (this.runtime === "wechat") {
      this.logger = wx.getRealtimeLogManager();
    }
  }

  _showToast(title, duration = 4000) {
    uni.showToast({
      title,
      icon: "none",
      duration,
    });
  }

  getEncryptOSSFileUrl(filename, absolute = false, md5Fn = null) {
    if (!md5Fn) {
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    // const expiresT = timestamp + 100;
    const rand = Math.floor(Math.random() * 100);
    const originUrl = absolute ? filename : `${this.ossUrl}/${filename}`;
    const f = originUrl.replace(this.ossUrl, "");
    const ss = `${f}-${timestamp}-${rand}-0-${ossKey}`;
    const encryptF = md5Fn(ss);
    return `${originUrl}?auth_key=${timestamp}-${rand}-0-${encryptF}`;
  }

  getOSSFileUrl = (filename, absolute = false) =>
    absolute ? filename : `${this.ossUrl}/${filename}`;

  r = async (options) => {
    try {
      const res = await this.request(options);
      if (res.statusCode !== 200) {
        throw res.data.message || "";
      } else {
        return res.data;
      }
    } catch (e) {
      if (this.logger) {
        this.logger.error(e);
      }
      throw e;
    }
  };

  request = async (options, retry = 0) => {
    const url = options.absoluteUrl
      ? options.absoluteUrl
      : `${this.baseUrl}${options.url}`;
    const token = uni.getStorageSync("token");
    const params = {
      header: {
        "Accept-Language": "zh-hans",
      },
      ...options,
      url,
    };
    if (!options.withoutToken) {
      if (token) {
        params.header.Authorization = `Bearer ${token}`;
      } else if (retry >= 5) {
        throw "请求错误，请重试";
      } else {
        await this.openidPromise;
        return await this.request(options, retry + 1);
      }
    }
    const [err, res] = await uni.request(params);
    if (err) {
      if (this.logger) {
        this.logger.error(err);
      }
      throw "请求错误，请重试";
    }
    if (res.statusCode === 401) {
      if (retry >= 5) {
        throw "网络不佳，请稍后重试";
      } else {
        await this.fetchOpenid(true);
        return await this.request(options, retry + 1);
      }
    }
    return res;
  };

  fetchOpenid = async (renew = false, retry = 0) => {
    const openid = uni.getStorageSync("openid");
    if (openid && !renew) {
      return openid;
    }
    const [err, res] = await uni.login();
    if (err) {
      if (this.logger) {
        this.logger.error(err);
      }
      if (retry > 2) {
        throw "登录失败";
      } else {
        return await this.fetchOpenid(false, retry + 1);
      }
    }
    try {
      const { openid, token } = await this.r({
        url: "/session/openid",
        method: "POST",
        withoutToken: true,
        data: {
          code: res.code,
          application: this.application,
          type: this.runtime,
        },
      });
      this.globalData.openid = openid;
      uni.setStorageSync("token", token);
      uni.setStorageSync("openid", openid);
      return openid;
    } catch (e) {
      if (retry > 2) {
        throw e || "登录失败";
      } else {
        return await this.fetchOpenid(false, retry + 1);
      }
    }
  };

  // Singleton openid
  openidPromise = new Promise(async (resolve, reject) => {
    try {
      const openid = await this.fetchOpenid();
      resolve(openid);
    } catch (e) {
      reject(e);
    }
  });

  getConfig = async () => {
    if (this.globalData.config) {
      return this.globalData.config;
    }
    try {
      const config = await this.r({
        url: `/announcement/announcements/${this.application}`,
        withoutToken: true,
      });
      this.globalData.config = config;
      this.cc = config.content;
      const currentVersion = uni.getStorageSync("version");
      uni.setStorageSync("version", config.version);
      if (config.version !== this.version) {
        this.globalData.verification = true;
      }
      return {
        ...config,
        updated: currentVersion !== config.version,
      };
    } catch (e) {
      throw e || "获取配置文件失败";
    }
  };

  uploadFileToOSS(options) {
    return new Promise((resolve, reject) => {
      this.request({
        url: "/session/oss/signature",
        method: "POST",
        data: {
          application: this.application,
        },
      }).then((res) => {
        if (res.statusCode !== 200) {
          reject("获取signature失败");
          return;
        }
        const { key, filePath, uploadHost, resultHost } = options;
        const { signature, oss_access_id, policy } = res.data;
        uni.uploadFile({
          url: uploadHost,
          filePath,
          name: "file",
          formData: {
            key,
            policy,
            OSSAccessKeyId: oss_access_id,
            signature,
          },
          success: (res) => {
            if (res.statusCode === 204 || res.statusCode === 200) {
              resolve(`${resultHost}/${key}`);
            }
          },
          fail: (err) => {
            if (this.logger) {
              this.logger.error(err);
            }
            reject("上传失败");
          },
        });
      });
    });
  }

  getQRCode = (openid) => {
    const url = uni.getStorageSync("qrcode");
    if (url) {
      return Promise.resolve(url);
    }
    return this.request({
      url: "/session/qrcode",
      method: "POST",
      data: {
        application: this.application,
        query: `openid=${openid}`,
        path: "pages/home/index",
        type: this.runtime,
      },
    }).then((res) => {
      if (res.data && res.data.url) {
        return uni
          .downloadFile({
            url: res.data.url,
          })
          .then((r) => {
            const [error, res1] = r;
            const path = res1.tempFilePath;
            uni.setStorageSync("qrcode", path);
            return path;
          });
      }
      return "";
    });
  };

  verifyText = async (text) => {
    const { code } = await this.r({
      url: "/session/security/text",
      method: "POST",
      data: {
        text,
        application: this.application,
      },
    });
    return code !== 87014;
  };

  getUserProfile = ({ desc }) => {
    return new Promise((resolve, reject) => {
      uni.getUserProfile({
        desc,
        success: (res) => {
          resolve(res);
        },
        fail: (err) => {
          if (this.logger) {
            this.logger.error(err);
          }
          reject("获取用户信息失败");
        },
      });
    });
  };

  getFeatureStatus = (cc, name) => {
    const { featureStatus } = cc;
    if (!featureStatus) {
      return {
        ok: true,
        message: ""
      };
    }
    const config = featureStatus[name];
    if (!config) {
      return {
        ok: true,
        message: ""
      };
    }
    return {
      ok: config.ok,
      message: config.message || featureStatus.defaultMessage,
    };
  };
}

const mpking = new Mpking();
export default mpking;
