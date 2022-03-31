import styled from "@emotion/styled";

import LastEditInfoLabel from "metabase/components/LastEditInfoLabel";

import { color } from "metabase/lib/colors";
import {
  breakpointMaxSmall,
  breakpointMinSmall,
} from "metabase/styled-components/theme";

export const HeaderRoot = styled.div`
  display: flex;
  align-items: center;

  ${breakpointMaxSmall} {
    flex-direction: column;
    align-items: baseline;
  }
`;

export const HeaderContent = styled.div`
  padding: 1rem 0;
`;

export const HeaderBadges = styled.div`
  display: flex;
  align-items: center;

  ${breakpointMaxSmall} {
    flex-direction: column;
    align-items: baseline;
  }
`;

export const HeaderBadgesDivider = styled.span`
  color: ${color("text-light")};
  font-size: 0.8em;

  margin-left: 0.5rem;
  margin-right: 0.5rem;

  ${breakpointMaxSmall} {
    display: none;
  }
`;

export const StyledLastEditInfoLabel = styled(LastEditInfoLabel)`
  ${breakpointMaxSmall} {
    margin-top: 4px;
  }
`;

export const HeaderButtonsContainer = styled.div`
  display: flex;
  align-items: center;
  color: ${color("text-dark")};

  ${breakpointMinSmall} {
    margin-left: auto;
  }

  ${breakpointMaxSmall} {
    width: 100%;
    margin-bottom: 6px;
  }
`;

export const HeaderButtonSection = styled.div`
  display: flex;
  align-items: center;

  ${breakpointMaxSmall} {
    width: 100%;
    justify-content: space-between;
  }
`;
