const {
  Attr, Constants, Cache, toArray, RedisStore, sysEnv
} = require("@drumee/server-essentials");

const {
  INVALID_DATA,
  VIGNETTE,
  ID_NOBODY
} = Constants;
const { Entity, FileIo } = require("@drumee/server-core");
const { existsSync, readFileSync } = require("fs");
const { isEmpty, isString, isArray, isObject } = require("lodash");

const { getPlugins } = require("../router/rest");
const { resolve } = require("path");
const { credential_dir } = sysEnv();
let file = resolve(credential_dir, `crypto/public.pem`);
let publicKey = readFileSync(file);

class Hello extends Entity {

  /**
 *
 */
  async authenticate() {
    let secret = this.input.need(Attr.secret);
    let code = this.input.need(Attr.code);
    const { ident } = this.input.use("vars") || {};
    if (this.session.isAnonymous()) {
      await this.session.authenticate(secret, code);
    } else {
      let user_id = this.user.get(Attr.id);
      let { uid } = (await this.yp.await_proc("otp_get", secret, code)) || {};
      if (uid) {
        if (uid == user_id) {
          this.output.data({ status: "ALREADY_SIGNED_IN" });
        } else {
          this.output.data({
            status: "CROSS_SIGNED_IN",
            current: profile.email,
            uid: this.user.get(Attr.id),
            input: ident,
          });
        }
      } else {
        this.output.data({ status: "ALREADY_ONLINE" });
      }
    }
  }

  /**
 * 
 * @returns 
 */
  async avatar() {
    const { resolve } = require("path");
    const type = this.input.get(Attr.type) || VIGNETTE;
    const id = this.input.get(Attr.id) || this.user.get(Attr.id);

    let row = await this.yp.await_proc("get_user", id);
    if (isEmpty(row)) {
      this.output.data({});
      return;
    }
    const jpg = resolve(row.home_dir, `__config__/icons/avatar-${type}.jpg`);
    const png = resolve(row.home_dir, `__config__/icons/avatar-${type}.png`);
    const svg = resolve(row.home_dir, `__config__/icons/avatar-${type}.svg`);
    let filename;
    const file = new FileIo(this);
    for (let file of [png, svg, jpg]) {
      if (existsSync(file)) {
        file.content(file);
        return;
      }
    }
    this.output.data({});
  }

  /**
   *
   */
  async env() {
    const yp = this.yp;
    let data = {
      platform: {},
    };
    let _def_fonts = await yp.await_query(
      "SELECT * FROM font WHERE family='Roboto' ORDER BY `name` ASC"
    );
    data.platform.fonts = [];
    data.platform.description = Cache.getSysConf('platform_intro_popup_title');
    if (data.platform.description) {
      data.platform.description = JSON.parse(data.platform.description);
    }
    data.platform.setup = await yp.await_query(
      "SELECT count(*) as ok FROM privilege where privilege>=63 AND domain_id=1"
    );

    let wp = Cache.getSysConf("wallpaper");
    if (isString(wp)) {
      data.platform.wallpaper = JSON.parse(wp);
    } else {
      data.platform.wallpaper = wp;
    }
    const hub = this.hub.toJSON();
    hub.stylesheets = await this.db.await_proc("style_get_files");
    hub.fonts_links = await this.db.await_proc("get_fonts_links");
    hub.fonts_faces = await this.db.await_proc("get_fonts_faces");
    if (!isEmpty(hub.fonts_faces)) {
      hub.fonts_faces = hub.fonts_faces.concat(_def_fonts);
    }
    if (!hub.exists) {
      this.exception.not_found("HUB_NOT_FOUND");
      return;
    }
    data.hub = { ...data.hub, ...hub };
    this.user.set(Attr.quota, {});
    data.user = await this.yp.await_proc("get_user", this.uid);
    data.user.quota = {};
    data.user.otp_key = this.session.get('secret');
    try {
      data.user.quota = this.parseJSON(data.user.quota);
    } catch (e) { }
    data.disk = await this.yp.await_proc("my_disk_limit", this.uid);

    data.organization = await this.yp.await_proc("my_organisation", this.uid);
    const { main_domain } = sysEnv();
    if (isEmpty(data.organization)) {
      let host = main_domain;
      if (this.uid == ID_NOBODY) {
        host = this.input.host();
      }
      data.organization = await this.yp.await_proc(
        "organisation_get",
        host
      );
    }
    if (isArray(data.organization)) {
      data.organization = data.organization[0] || {};
    }
    data.organization.useEmail = global.myDrumee.useEmail || 0;
    data.user.is_reseller = 0;
    if (data.organization.metadata) {
      data.user.is_reseller = data.organization.metadata.is_reseller || 0;
    } else {
      data.organization.metadata = {};
    }
    data.user.main_domain = main_domain;
    if (this.user.get("signed_in")) {
      data.user.signed_in = 1;
      data.user.connection = "online";
    } else {
      data.user.signed_in = 0;
      data.user.connection = "offline";
    }
    data.user.privilege = data.organization.privilege; // To be use from withon origanization
    data.main_domain = main_domain;
    data.hub = hub;
    data.platform.intl = this.supportedLanguage();
    data.platform.arch = global.myDrumee.arch || "pod";
    data.platform.cdnHost = global.myDrumee.cdnHost;
    data.platform.version = global.VERSION;
    data.platform.licence = {
      signature: await this.yp.await_func("sys_conf_get", "licence_signature"),
      content: await this.yp.await_func("sys_conf_get", "licence_content"),
    };
    if (
      global.myDrumee.isPublic &&
      global.myDrumee.useEmail &&
      global.myDrumee.arch == "cloud"
    ) {
      data.platform.isPublic = 1;
    }
    let plugins = getPlugins();
    if (plugins) {
      data.platform.plugins = plugins;
    }
    data.plateform = data.platform; // tmp
    this.output.data(data);
  }


  /**
   *
   */
  files_formats() {
    const yp = this.yp;
    // const hub = this.hub.toJSON();
    this.yp.query(
      "select extension, category, mimetype, capability from filecap",
      this.output.list
    );
  }

  /**
 *
 */
  async get_hub() {
    const hub = this.hub.toJSON();
    hub.stylesheets = await this.db.await_proc("style_get_files");
    hub.fonts_links = await this.db.await_proc("get_fonts_links");
    hub.fonts_faces = await this.db.await_proc("get_fonts_faces");
    if (hub.hostname == null) {
      this.exception.not_found("HUB_NOT_FOUND");
      return;
    }
    this.output.data(hub);
  }


  /**
   * 
   */
  get_laguages() {
    const name = this.input.use(Attr.value, "") || this.input.use(Attr.name, "");
    const page = this.input.use(Attr.page) || 1;
    this.yp.call_proc("get_laguages", name, page, this.output.data);
  }

  /**
   *
   */
  async login() {
    let profile = this.user.get(Attr.profile) || {};
    const vars = this.input.need("vars");
    if (this.user.get("signed_in")) {
      let username = this.user.get(Attr.username);
      if ([username, profile.email, this.uid].includes(vars.ident)) {
        this.output.data({ status: "ALREADY_SIGNED_IN" });
      } else {
        this.output.data({
          status: "CROSS_SIGNED_IN",
          current: profile.email,
          uid: this.user.get(Attr.id),
          input: vars.ident,
        });
      }
      return;
    }
    await this.session.login(this.input.use("vars"), this.input.use("resent"));
  }

  /**
   *
   */
  async me() {
    let user = await this.yp.await_proc("get_user", this.uid);
    if (this.user.get("signed_in")) {
      user.signed_in = 1;
      user.connection = "online";
    } else {
      user.signed_in = 0;
      user.connection = "offline";
    }
    this.output.data(user);
  }

  /**
   *
   */
  async ping() {
    let data = this.input.get("data");
    if (data && data == "debug") {
      this.output.data({ verbosity: global.verbosity, modules: global.debug });
      await RedisStore.sendData(data);
      return;
    }
    this.debug("AAA:505", data);
    if (!data) {
      data = "Pong";
    }
    if (isObject(data)) {
      this.output.data(data);
    } else {
      this.output.data({ response: data });
    }
  }

  /**
   * 
   */
  public_key() {
    this.output.text(publicKey);
  }

  /**
   *
   */
  async reset_session() {
    let socket_id = this.input.need(Attr.socket_id);
    let sid = this.input.sid();
    if (!sid || [null, "null", undefined, "undefined"].includes(sid)) {
      return this.excetion.user(INVALID_DATA);
    }
    await this.yp.await_proc("session_reset", sid, this.uid, socket_id);
    this.output.data({ sid, uid: this.uid });
  }


  /**
  *
  */
  async sys_var() {
    let name = this.input.need(Attr.name);
    let r = await this.yp.await_run(
      "SELECT * FROM sys_var WHERE `name`=? ",
      name
    );
    this.output.data(r);
  }
}

module.exports = Hello;
