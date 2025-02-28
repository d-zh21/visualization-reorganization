/* eslint-disable react/prop-types */
import React, { Component } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router";
import { connect } from "react-redux";
import { t } from "ttag";

import title from "metabase/hoc/Title";
import * as MetabaseAnalytics from "metabase/lib/analytics";
import MetabaseSettings from "metabase/lib/settings";
import AdminLayout from "metabase/components/AdminLayout";
import { NotFound } from "metabase/containers/ErrorPages";

import SettingsSetting from "../components/SettingsSetting";

import { prepareAnalyticsValue } from "metabase/admin/settings/utils";

import _ from "underscore";
import cx from "classnames";

import {
  getSettings,
  getSettingValues,
  getDerivedSettingValues,
  getSections,
  getActiveSection,
  getActiveSectionName,
  getNewVersionAvailable,
} from "../selectors";
import { initializeSettings, updateSetting, reloadSettings } from "../settings";

const mapStateToProps = (state, props) => {
  return {
    settings: getSettings(state, props),
    settingValues: getSettingValues(state, props),
    derivedSettingValues: getDerivedSettingValues(state, props),
    sections: getSections(state, props),
    activeSection: getActiveSection(state, props),
    activeSectionName: getActiveSectionName(state, props),
    newVersionAvailable: getNewVersionAvailable(state, props),
  };
};

const mapDispatchToProps = {
  initializeSettings,
  updateSetting,
  reloadSettings,
};

class SettingsEditorApp extends Component {
  layout = null; // the reference to AdminLayout

  static propTypes = {
    sections: PropTypes.object.isRequired,
    activeSection: PropTypes.object,
    activeSectionName: PropTypes.string,
    updateSetting: PropTypes.func.isRequired,
  };

  constructor(props) {
    super(props);
    this.saveStatusRef = React.createRef();
  }

  componentDidMount() {
    this.props.initializeSettings();
  }

  updateSetting = async (setting, newValue) => {
    const { settingValues, updateSetting, reloadSettings } = this.props;

    this.saveStatusRef.current.setSaving();

    const oldValue = setting.value;

    // TODO: mutation bad!
    setting.value = newValue;
    try {
      if (setting.onBeforeChanged) {
        await setting.onBeforeChanged(
          oldValue,
          newValue,
          settingValues,
          this.handleChangeSetting,
        );
      }

      if (!setting.disableDefaultUpdate) {
        await updateSetting(setting);
      }

      if (setting.onChanged) {
        await setting.onChanged(
          oldValue,
          newValue,
          settingValues,
          this.handleChangeSetting,
        );
      }

      if (setting.disableDefaultUpdate) {
        await reloadSettings();
      }

      this.saveStatusRef.current.setSaved();

      const value = prepareAnalyticsValue(setting);

      MetabaseAnalytics.trackStructEvent(
        "General Settings",
        setting.display_name || setting.key,
        value,
        // pass the actual value if it's a number
        typeof value === "number" && value,
      );
    } catch (error) {
      const message =
        error && (error.message || (error.data && error.data.message));
      this.saveStatusRef.current.setSaveError(message);
      MetabaseAnalytics.trackStructEvent(
        "General Settings",
        setting.display_name,
        "error",
      );
    }
  };

  handleChangeSetting = (key, value) => {
    const { settings, updateSetting } = this.props;
    const setting = _.findWhere(settings, { key });
    if (!setting) {
      console.error(`Attempted to change unknown setting ${key}`);
      throw new Error(t`Unknown setting ${key}`);
    }
    return updateSetting({ ...setting, value });
  };

  renderSettingsPane() {
    const {
      activeSection,
      settings,
      settingValues,
      derivedSettingValues,
    } = this.props;
    const isLoading = settings.length === 0;

    if (isLoading) {
      return null;
    }

    if (!activeSection) {
      return <NotFound />;
    }

    if (activeSection.component) {
      return (
        <activeSection.component
          elements={activeSection.settings}
          settingValues={settingValues}
          updateSetting={this.updateSetting}
        />
      );
    } else {
      return (
        <ul>
          {activeSection.settings
            .filter(setting =>
              setting.getHidden
                ? !setting.getHidden(settingValues, derivedSettingValues)
                : true,
            )
            .map((setting, index) => (
              <SettingsSetting
                key={setting.key}
                setting={setting}
                onChange={this.updateSetting.bind(this, setting)}
                onChangeSetting={this.handleChangeSetting}
                reloadSettings={this.props.reloadSettings}
                autoFocus={index === 0}
                settingValues={settingValues}
              />
            ))}
        </ul>
      );
    }
  }

  renderSettingsSections() {
    const { sections, activeSectionName, newVersionAvailable } = this.props;

    const renderedSections = Object.entries(sections).map(
      ([slug, section], idx) => {
        // HACK - This is used to hide specific items in the sidebar and is currently
        // only used as a way to fake the multi page auth settings pages without
        // requiring a larger refactor.
        if (section.sidebar === false) {
          return false;
        }

        // The nested authentication routes should be matched just on the prefix:
        // e.g. "authentication/google" => "authentication"
        const [sectionNamePrefix] = activeSectionName.split("/");

        const classes = cx(
          "AdminList-item",
          "flex",
          "align-center",
          "justify-between",
          "no-decoration",
          { selected: slug === sectionNamePrefix },
        );

        // if this is the Updates section && there is a new version then lets add a little indicator
        const shouldDisplayNewVersionIndicator =
          slug === "updates" &&
          newVersionAvailable &&
          !MetabaseSettings.isHosted();

        const newVersionIndicator = shouldDisplayNewVersionIndicator ? (
          <span
            style={{ padding: "4px 8px 4px 8px" }}
            className="bg-brand rounded text-white text-bold h6"
          >
            1
          </span>
        ) : null;

        return (
          <li key={slug}>
            <Link to={"/admin/settings/" + slug} className={classes}>
              <span>{section.name}</span>
              {newVersionIndicator}
            </Link>
          </li>
        );
      },
    );

    return (
      <div className="MetadataEditor-table-list AdminList flex-no-shrink">
        <ul className="AdminList-items pt1">{renderedSections}</ul>
      </div>
    );
  }

  render() {
    return (
      <AdminLayout
        saveStatusRef={this.saveStatusRef}
        title={t`Settings`}
        sidebar={this.renderSettingsSections()}
      >
        {this.renderSettingsPane()}
      </AdminLayout>
    );
  }
}

export default _.compose(
  connect(mapStateToProps, mapDispatchToProps),
  title(({ activeSection }) => activeSection && activeSection.name),
)(SettingsEditorApp);
